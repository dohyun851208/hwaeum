# -*- coding: utf-8 -*-
"""
curate-western-samples.py — 필하모니아 서양 선율 음원 멀티샘플 큐레이션 도구

원본(`선율-서양(philharmonia)/`)은 한 음마다 길이·세기·주법별로 수백 개 변형을 담고 있다.
이 도구는 악기마다 **음(피치)별로 깨끗한 지속음 1개씩**만 골라
`sound/선율-서양(필하모니아)/<현|관>/<악기>/<악기>_<음이름>.mp3` 구조로 복사하고,
오디오 엔진이 "가장 가까운 실제 녹음"을 골라 미세 피치시프트만 하도록
멀티샘플 맵(`js/sample-maps-western.js`)을 생성한다.

선택 우선순위
  - 현악기 sustained 프로필:
      violin           = forte       + arco-normal
      viola            = piano       + arco-normal
      cello            = forte       + arco-normal
      doubleBass       = mezzo-forte + arco-normal
      cello 는 기존 규칙 그대로 유지한다.
  - violin / viola / doubleBass 는 샘플의 28~78% 루프 구간을 실측해
      길이·발음·루프 안정성·루프 끝 음량이 충분한 후보를 고른다.
      원래 세기에 좋은 후보가 없으면 다른 세기의 arco-normal 을 허용한다.
  - 주법(articulation): normal / arco-normal  (피치카토·트레몰로·트릴 등 제외)
  - 길이(duration)    : 15 > 1 > 05 > 025 > very-long  (phrase / long 제외)
  - 세기(dynamic)     : mezzo-forte > forte > mezzo-piano > piano > fortissimo > pianissimo
                        (cresc-decresc / molto-pianissimo 등 제외)

실행:
  python tools/curate-western-samples.py
  PHILHARMONIA_RAW_BASE="<원본 폴더>" python tools/curate-western-samples.py
  CURATE_ONLY=violin,viola,doubleBass PHILHARMONIA_RAW_BASE="<원본 폴더>" python tools/curate-western-samples.py
"""

import array
import math
import os
import re
import shutil
import subprocess
import sys

# UTF-8 출력 (Windows 콘솔)
sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(HERE)                       # sound-drawing-tool/
SONG_DIR = os.path.dirname(PROJECT_DIR)                   # baeum/song/
RAW_BASE = os.environ.get("PHILHARMONIA_RAW_BASE") or os.path.join(SONG_DIR, "선율-서양(philharmonia)")
DEST_REL = os.path.join("sound", "선율-서양(필하모니아)")
DEST_BASE = os.path.join(PROJECT_DIR, DEST_REL)
GENERATED_JS = os.path.join(PROJECT_DIR, "js", "sample-maps-western.js")


def env_id_set(name):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    aliases = {"doublebass": "doubleBass", "double-bass": "doubleBass"}
    ids = set()
    for item in re.split(r"[,\s]+", raw):
        if not item:
            continue
        ids.add(aliases.get(item.lower(), item))
    return ids


CURATE_ONLY = env_id_set("CURATE_ONLY")

# (원본 하위경로, 대상 그룹폴더, 악기 id) — id는 manifest.js melodies 키와 일치
INSTRUMENTS = [
    ("현/violin", "현", "violin"),
    ("현/viola", "현", "viola"),
    ("현/cello", "현", "cello"),
    ("현/double bass", "현", "doubleBass"),
    ("관/clarinet", "관", "clarinet"),
    ("관/oboe", "관", "oboe"),
    ("관/flute", "관", "flute"),
    ("관/french horn", "관", "frenchHorn"),
]

ARTIC_RANK = {"normal": 0, "arco-normal": 0}              # 그 외 주법은 제외
DUR_RANK = {"15": 0, "1": 1, "05": 2, "025": 3, "very-long": 4}  # phrase/long 제외
DYN_RANK = {
    "mezzo-forte": 0,
    "forte": 1,
    "mezzo-piano": 2,
    "piano": 3,
    "fortissimo": 4,
    "pianissimo": 5,
}

# 현악기는 지속음 품질을 위해 악기 안에서 세기와 주법을 고정한다.
STRING_SUSTAIN_PROFILES = {
    "violin": {"articulation": ["arco-normal"], "dynamic": ["forte"]},
    "viola": {"articulation": ["arco-normal"], "dynamic": ["piano"]},
    "cello": {"articulation": ["arco-normal"], "dynamic": ["forte"]},
    "doubleBass": {"articulation": ["arco-normal"], "dynamic": ["mezzo-forte"]},
}

MEASURED_STRING_IDS = {"violin", "viola", "doubleBass"}
MEASURED_STRING_DUR_RANK = {"15": 0, "1": 1, "05": 2, "025": 3}
MEASURED_DYNAMIC_ORDER = {
    "violin": ["forte", "fortissimo", "mezzo-forte", "mezzo-piano", "piano", "pianissimo"],
    "viola": ["piano", "mezzo-piano", "forte", "fortissimo", "mezzo-forte", "pianissimo"],
    "doubleBass": ["mezzo-forte", "forte", "fortissimo", "mezzo-piano", "piano", "pianissimo"],
}
MEASURE_SAMPLE_RATE = 22050
MIN_MEASURED_DURATION_SECONDS = 1.8
MIN_LOOP_MEAN_DB = -40.0
MIN_ONSET_DB = -42.0
MIN_LOOP_TAIL_DB = -40.0
MAX_LOOP_SPREAD_DB = 12.0

# Hand curation for samples whose exact note source is too short for visible sustain.
# cents describes the source pitch relative to the target midi entry.
SAMPLE_OVERRIDES = {
    ("oboe", 88): {"srcMidi": 89, "srcToken": "F6", "cents": 100},
}

SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
NOTE_RE = re.compile(r"^([A-Ga-g])(s?)(\d)$")
MAP_BLOCK_RE = re.compile(r"^\s{4}(\w+): \[\n([\s\S]*?)^\s{4}\],", re.MULTILINE)
MAP_ENTRY_RE = re.compile(
    r'\{\s*midi:\s*(\d+),\s*note:\s*"([^"]+)",\s*src:\s*"([^"]+)"(?:,\s*cents:\s*(-?\d+(?:\.\d+)?))?\s*\}'
)


def parse_note(token):
    """'As3' -> (midi, 'A#3', 'As3'). 매칭 안 되면 None."""
    m = NOTE_RE.match(token)
    if not m:
        return None
    letter = m.group(1).upper()
    sharp = m.group(2) == "s"
    octave = int(m.group(3))
    midi = (octave + 1) * 12 + SEMITONE[letter] + (1 if sharp else 0)
    pretty = letter + ("#" if sharp else "") + str(octave)
    token_norm = letter + ("s" if sharp else "") + str(octave)
    return midi, pretty, token_norm


def rank_from_order(values):
    return {value: idx for idx, value in enumerate(values)}


def selection_ranks(inst_id):
    profile = STRING_SUSTAIN_PROFILES.get(inst_id)
    if not profile:
        return ARTIC_RANK, DUR_RANK, DYN_RANK
    return (
        rank_from_order(profile["articulation"]),
        DUR_RANK,
        rank_from_order(profile["dynamic"]),
    )


def select_for_instrument(raw_dir, inst_id):
    """음(midi)마다 우선순위로 최적 파일 1개 선택. {midi: (pretty, token_norm, src_path)}"""
    if inst_id in MEASURED_STRING_IDS:
        return select_measured_string(raw_dir, inst_id)

    best = {}  # midi -> (score_tuple, pretty, token_norm, path)
    if not os.path.isdir(raw_dir):
        print("  ! 원본 폴더 없음:", raw_dir)
        return {}
    artic_rank, dur_rank, dyn_rank = selection_ranks(inst_id)
    for fname in os.listdir(raw_dir):
        if not fname.lower().endswith(".mp3"):
            continue
        parsed_name = parse_sample_name(fname)
        if not parsed_name:
            continue
        note_tok, dur, dyn, artic = parsed_name
        if artic not in artic_rank or dur not in dur_rank or dyn not in dyn_rank:
            continue
        parsed = parse_note(note_tok)
        if not parsed:
            continue
        midi, pretty, token_norm = parsed
        score = (artic_rank[artic], dur_rank[dur], dyn_rank[dyn])
        cur = best.get(midi)
        if cur is None or score < cur[0]:
            best[midi] = (score, pretty, token_norm, os.path.join(raw_dir, fname))
    return best


def parse_sample_name(fname):
    stem = fname[:-4] if fname.lower().endswith(".mp3") else fname
    parts = stem.split("_")
    if len(parts) < 5:
        return None
    return parts[1], parts[2], parts[3], parts[4]


def decode_mono_s16(path, sample_rate=MEASURE_SAMPLE_RATE):
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(sample_rate), "-"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace").strip() or f"ffmpeg failed: {path}")
    samples = array.array("h")
    samples.frombytes(result.stdout)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples, sample_rate


def db_for_range(samples, sample_rate, start, end):
    start_i = max(0, min(len(samples), int(start * sample_rate)))
    end_i = max(0, min(len(samples), int(end * sample_rate)))
    if end_i <= start_i:
        return float("-inf")
    total = 0
    for value in samples[start_i:end_i]:
        total += value * value
    rms = math.sqrt(total / (end_i - start_i)) / 32768
    if rms <= 0:
        return float("-inf")
    return 20 * math.log10(rms)


def candidate_metrics(path):
    samples, sample_rate = decode_mono_s16(path)
    duration = len(samples) / sample_rate if sample_rate else 0
    loop_start = duration * 0.28
    loop_end = duration * 0.78
    loop_len = max(0, loop_end - loop_start)
    loop_db = db_for_range(samples, sample_rate, loop_start, loop_end)
    onset_end = max(0.08, min(0.45, duration * 0.24))
    onset_db = db_for_range(samples, sample_rate, 0.05, onset_end)
    chunks = []
    for idx in range(4):
        chunk_start = loop_start + loop_len * idx / 4
        chunk_end = loop_start + loop_len * (idx + 1) / 4
        chunks.append(db_for_range(samples, sample_rate, chunk_start, chunk_end))
    finite_chunks = [value for value in chunks if math.isfinite(value)]
    loop_spread_db = max(finite_chunks) - min(finite_chunks) if len(finite_chunks) == 4 else float("inf")
    loop_tail_db = chunks[-1] if chunks else float("-inf")
    failures = []
    if duration < MIN_MEASURED_DURATION_SECONDS:
        failures.append("duration")
    if loop_db < MIN_LOOP_MEAN_DB:
        failures.append("loopMean")
    if onset_db < MIN_ONSET_DB:
        failures.append("onset")
    if loop_tail_db < MIN_LOOP_TAIL_DB:
        failures.append("loopTail")
    if loop_spread_db > MAX_LOOP_SPREAD_DB:
        failures.append("loopSpread")
    return {
        "duration": duration,
        "loopDb": loop_db,
        "onsetDb": onset_db,
        "loopSpreadDb": loop_spread_db,
        "loopTailDb": loop_tail_db,
        "failures": failures,
        "usable": not failures,
    }


def measured_dynamic_rank(inst_id, dyn):
    order = MEASURED_DYNAMIC_ORDER.get(inst_id, [])
    if dyn in order:
        return order.index(dyn)
    return len(order) + DYN_RANK.get(dyn, 99)


def measured_candidate_score(inst_id, dur, dyn, metrics):
    dur_rank = MEASURED_STRING_DUR_RANK.get(dur, 99)
    dyn_rank = measured_dynamic_rank(inst_id, dyn)
    duration = metrics["duration"]
    loop_db = metrics["loopDb"]
    spread = metrics["loopSpreadDb"]
    if metrics["usable"]:
        return (
            0,
            dur_rank,
            dyn_rank,
            max(0, duration - 2.8),
            spread,
            -loop_db,
        )

    quiet_penalty = max(0, MIN_LOOP_MEAN_DB - loop_db) / 10
    onset_penalty = max(0, MIN_ONSET_DB - metrics["onsetDb"]) / 10
    tail_penalty = max(0, MIN_LOOP_TAIL_DB - metrics["loopTailDb"]) / 10
    spread_penalty = max(0, spread - MAX_LOOP_SPREAD_DB) / 10
    duration_penalty = max(0, MIN_MEASURED_DURATION_SECONDS - duration)
    penalty = duration_penalty + quiet_penalty + onset_penalty + tail_penalty + spread_penalty
    return (1, penalty, dur_rank, dyn_rank, -duration)


def select_measured_string(raw_dir, inst_id):
    """violin/viola/doubleBass: 루프 안정성과 실효 음량을 실측해 음별 샘플을 고른다."""
    best = {}
    checked = 0
    usable_count = 0
    decode_failures = []
    fallback_notes = []
    if not os.path.isdir(raw_dir):
        print("  ! 원본 폴더 없음:", raw_dir)
        return {}

    for fname in os.listdir(raw_dir):
        if not fname.lower().endswith(".mp3"):
            continue
        parsed_name = parse_sample_name(fname)
        if not parsed_name:
            continue
        note_tok, dur, dyn, artic = parsed_name
        if artic != "arco-normal":
            continue
        if dur not in MEASURED_STRING_DUR_RANK:
            continue
        if "cresc" in dyn or dyn.startswith("molto-"):
            continue
        parsed_note = parse_note(note_tok)
        if not parsed_note:
            continue

        src_path = os.path.join(raw_dir, fname)
        try:
            metrics = candidate_metrics(src_path)
        except RuntimeError as exc:
            decode_failures.append(f"{fname}: {str(exc).splitlines()[0]}")
            continue
        checked += 1
        if metrics["usable"]:
            usable_count += 1
        midi, pretty, token_norm = parsed_note
        score = measured_candidate_score(inst_id, dur, dyn, metrics)
        cur = best.get(midi)
        if cur is None or score < cur[0]:
            best[midi] = (score, pretty, token_norm, src_path, metrics, fname)

    for _midi, selected in sorted(best.items()):
        metrics = selected[4]
        if not metrics["usable"]:
            fallback_notes.append(f"{selected[1]}:{selected[5]}[{','.join(metrics['failures'])}]")
    print(f"  measured candidates={checked}, usable={usable_count}, selected={len(best)}")
    if decode_failures:
        print("  ! 디코드 실패 후보 제외:", "; ".join(decode_failures[:3]))
        if len(decode_failures) > 3:
            print(f"    ... +{len(decode_failures) - 3} more")
    if fallback_notes:
        print("  ! 실측 조건 미달 fallback:", "; ".join(fallback_notes[:8]))
        if len(fallback_notes) > 8:
            print(f"    ... +{len(fallback_notes) - 8} more")
    return best


def js_str(path_parts):
    return "/".join(path_parts)


def parse_cents(value):
    if value is None:
        return None
    as_float = float(value)
    return int(as_float) if as_float.is_integer() else as_float


def read_existing_western_maps():
    if not os.path.exists(GENERATED_JS):
        return {}
    src = open(GENERATED_JS, "r", encoding="utf-8").read()
    maps = {}
    for block in MAP_BLOCK_RE.finditer(src):
        inst_id = block.group(1)
        entries = []
        for match in MAP_ENTRY_RE.finditer(block.group(2)):
            entry = {"midi": int(match.group(1)), "note": match.group(2), "src": match.group(3)}
            cents = parse_cents(match.group(4))
            if cents is not None:
                entry["cents"] = cents
            entries.append(entry)
        if entries:
            maps[inst_id] = entries
    return maps


def should_curate(inst_id):
    return CURATE_ONLY is None or inst_id in CURATE_ONLY


def summary_row(inst_id, entries):
    base = entries[len(entries) // 2]
    return (inst_id, len(entries), entries[0]["note"], entries[-1]["note"], base["midi"], base["note"], base["src"])


def main():
    os.makedirs(os.path.dirname(GENERATED_JS), exist_ok=True)
    existing_maps = read_existing_western_maps()
    maps = {}        # id -> list of {midi, note, src}
    summary = []

    if CURATE_ONLY:
        print("CURATE_ONLY:", ", ".join(sorted(CURATE_ONLY)))

    for raw_sub, group_kr, inst_id in INSTRUMENTS:
        raw_dir = os.path.join(RAW_BASE, *raw_sub.split("/"))
        print(f"[{inst_id}] {raw_dir}")
        if not should_curate(inst_id):
            entries = existing_maps.get(inst_id)
            if entries:
                maps[inst_id] = entries
                summary.append(summary_row(inst_id, entries))
                print(f"  -> 기존 블록 보존 ({len(entries)} notes)")
            else:
                print("  ! 기존 블록 없음: 보존할 수 없어 건너뜀")
            continue

        best = select_for_instrument(raw_dir, inst_id)
        if not best:
            print("  (선택된 음 없음)")
            if CURATE_ONLY and inst_id in CURATE_ONLY:
                raise SystemExit(f"{inst_id}: 선택된 음 없음")
            continue

        dest_dir = os.path.join(DEST_BASE, group_kr, inst_id)
        if os.path.isdir(dest_dir):
            shutil.rmtree(dest_dir)
        os.makedirs(dest_dir, exist_ok=True)

        entries = []
        for midi in sorted(best):
            _score, pretty, token_norm, src_path = best[midi][:4]
            override = SAMPLE_OVERRIDES.get((inst_id, midi))
            cents = None
            if override:
                token_norm = override["srcToken"]
                cents = override["cents"]
                if override["srcMidi"] in best:
                    src_path = best[override["srcMidi"]][3]
            dest_name = f"{inst_id}_{token_norm}.mp3"
            shutil.copy2(src_path, os.path.join(dest_dir, dest_name))
            rel = js_str(["sound", "선율-서양(필하모니아)", group_kr, inst_id, dest_name])
            entry = {"midi": midi, "note": pretty, "src": rel}
            if cents is not None:
                entry["cents"] = cents
            entries.append(entry)

        maps[inst_id] = entries
        summary.append(summary_row(inst_id, entries))
        base = entries[len(entries) // 2]
        print(f"  -> {len(entries)} notes  ({entries[0]['note']}…{entries[-1]['note']})  base={base['note']}({base['midi']})")

    # --- js/sample-maps-western.js 생성 ---
    lines = []
    lines.append("/*")
    lines.append(" * sample-maps-western.js — AUTO-GENERATED by tools/curate-western-samples.py")
    lines.append(" * 서양 선율 악기 멀티샘플 맵: 음(midi)마다 실제 녹음 파일(src)을 가리킨다.")
    lines.append(" * 손으로 고치지 말고 도구를 다시 실행하세요. (원본: 선율-서양(philharmonia)/)")
    lines.append(" */")
    lines.append(';(function (root) {')
    lines.append('  "use strict"')
    lines.append("  const data = root.SDStudioData")
    lines.append("  if (!data || !data.melodies) return")
    lines.append("")
    lines.append("  const westernMaps = {")
    for inst_id, _n, _lo, _hi, _bm, _bn, _bs in summary:
        lines.append(f"    {inst_id}: [")
        for e in maps[inst_id]:
            cents = f', cents: {e["cents"]}' if "cents" in e else ""
            lines.append(
                f'      {{ midi: {e["midi"]}, note: "{e["note"]}", src: "{e["src"]}"{cents} }},'
            )
        lines.append("    ],")
    lines.append("  }")
    lines.append("")
    lines.append("  Object.keys(westernMaps).forEach(function (id) {")
    lines.append("    const asset = data.melodies[id]")
    lines.append("    const map = westernMaps[id]")
    lines.append("    if (!asset || !map || !map.length) return")
    lines.append("    asset.sampleMap = map")
    lines.append('    asset.sampleMode = "multi"')
    lines.append("    asset.lowMidi = map[0].midi")
    lines.append("    asset.highMidi = map[map.length - 1].midi")
    lines.append("    asset.baseMidi = map[Math.floor(map.length / 2)].midi")
    lines.append("  })")
    lines.append('})(typeof self !== "undefined" ? self : this)')
    lines.append("")

    with open(GENERATED_JS, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print("\n=== 생성 요약 ===")
    print(f"generated: {os.path.relpath(GENERATED_JS, PROJECT_DIR)}")
    for inst_id, n, lo, hi, bm, bn, bs in summary:
        print(f"  {inst_id:12s} notes={n:3d}  range={lo}…{hi}  base={bn}({bm})  src={bs}")
    print("\nmanifest.js 의 각 melodies[id].src 를 위 src 로 맞추세요.")


if __name__ == "__main__":
    main()
