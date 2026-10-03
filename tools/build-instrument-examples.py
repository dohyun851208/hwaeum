# -*- coding: utf-8 -*-
"""
build-instrument-examples.py — 2단계 악기 감상 연주곡 다듬기 도구

2단계 악기 카드의 ▶ 연주곡은 `new Audio()`로 그대로 튼다(studio-setup-render.js `toggleExamplePreview`).
선율 악기처럼 엔진의 악기·음별 음량 보정을 거치지 않으므로 **파일 음량이 곧 앱 속 음량**이다.

이 도구는 원본 녹음(악구 여러 개면 차례로 이어 붙임)을 자르고 → 목표 음량(LUFS)으로 맞추고 → 페이드 →
MP3(44.1kHz 192k)로 쓴다. 소리를 깎는 리미터는 쓰지 않는다 — 트루피크가 -1 dBTP를 넘으면 목표보다 덜 키운다.
출처와 다듬은 방식은 아래 EXAMPLES 표가 기록이다.

실행:
  python tools/build-instrument-examples.py
  EXAMPLE_RAW_BASE="<원본 폴더>" python tools/build-instrument-examples.py
  BUILD_ONLY="단소 · 청성곡" python tools/build-instrument-examples.py

원본은 배포 트리 밖에 둔다(vercel --prod 가 작업 트리를 통째로 올리므로).
기본 위치는 저장소 옆 `감상-연주곡-원본/` 이고, 받는 곳은 각 항목 주석에 있다.
2026-10-03 원본 폴더를 지웠다(완성 MP3만 저장소에 있다). 다시 만들려면 주석의 주소에서 받아 표의 파일 이름으로 둔다 —
국립국악원은 악구 다운로드에서 사용 목적 양식(비상업용·교육용·기관명)을 써야 받히고, zip 안의 `w5-190-010.wav`를
`국립국악원-단소-청성곡-w5-190-010.wav`처럼 바꾼다.
원본이 없는 항목은 건너뛴다. ffmpeg 필요.
"""

import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(HERE)
GUGAK_DIR = os.path.join(PROJECT_DIR, "sound", "감상-연주곡(국립국악원)")
WESTERN_DIR = os.path.join(PROJECT_DIR, "sound", "감상-연주곡(서양악기)")
RAW_BASE = os.environ.get("EXAMPLE_RAW_BASE") or os.path.join(os.path.dirname(PROJECT_DIR), "감상-연주곡-원본")

PEAK_CEILING_DB = -1.0
SAMPLE_RATE = 44100
BITRATE = "192k"

# 목표 음량은 같은 무리 카드의 연주곡에 맞춘다.
# 국악 관악기: 소금 수제천025 -15.2, 대금 아리랑 -17.7 LUFS (둘 다 모노 — 스테레오로 들으면 3 dB 크게 들린다).
EXAMPLES = [
    {
        "label": "단소 · 청성곡",
        # 국립국악원 디지털음원 › 악구 다운로드 › 단소 › 풍류 › 청성곡(Cheongseong Jajinhanip by Danso solo)
        # https://www.gugak.go.kr/digitaleum/front/phrase/list.do — 공공누리 제1유형(출처표시), 24bit 44.1kHz 모노 WAV.
        # 010·020·025 = 1장 1장단 1~12정간(곡의 맨 처음). 악구마다 끝에 0.6~0.8초 숨 쉬는 무음이 있어 그대로 잇는다.
        "sources": [
            (RAW_BASE, "국립국악원-단소-청성곡-w5-190-010.wav"),
            (RAW_BASE, "국립국악원-단소-청성곡-w5-190-020.wav"),
            (RAW_BASE, "국립국악원-단소-청성곡-w5-190-025.wav"),
        ],
        "out": (GUGAK_DIR, "단소-청성곡.mp3"),
        "start": 0.0,
        "end": 21.30,  # 마지막 악구 뒤 무음 0.68초 중 0.45초만 남긴다.
        "channels": 1,
        "fade_in": 0.005,
        "fade_out": 0.25,
        "target_lufs": -16,
    },
    # 서양 악기: 사용자가 '작다'고 하지 않은 호른 -18.9, 오보에 -21.7, 비올라 -22.2 LUFS(스테레오) 쪽에 맞춰 -18.
    # 예전 플루트·바이올린·더블베이스 연주곡은 -34·-29·-25 LUFS에, 원본부터 10 kHz 위가 비어 먹먹했다(10~16 kHz -60~-65 dB).
    # CC BY / CC BY-SA 녹음이라 2단계 아래 출처 줄(studio.js AUDIO_MODE_CREDIT)과 sound/감상-연주곡(서양악기)/라이센스.txt 에 적는다.
    {
        "label": "플루트 · 슈타미츠 카프리치오",
        # 위키미디어 공용 File:Stamitz_-_Capriccio_1_Allegro_moderato.ogg — Kristina Martincová(플루트),
        # Wikipedia 10 기념 음악회(프라하, 2011-01-15). CC BY-SA 3.0 Unported(VRT 2011040610001736). 플루트 혼자.
        # https://upload.wikimedia.org/wikipedia/commons/f/fa/Stamitz_-_Capriccio_1_Allegro_moderato.ogg
        "sources": [(RAW_BASE, "위키미디어-Stamitz_-_Capriccio_1_Allegro_moderato.ogg")],
        "out": (WESTERN_DIR, "플루트-슈타미츠.mp3"),
        "start": 0.75,  # 첫 음 1.15초 직전부터, 숨 쉬는 자리(20.7초)에서 끝낸다.
        "end": 20.7,
        "channels": 2,
        "fade_in": 0.05,
        "fade_out": 0.6,
        "target_lufs": -18,
    },
    {
        "label": "바이올린 · 보케리니 미뉴에트",
        # 프리사운드 #25481 "violin minuet_boccherini (edit).wav" — FreqMan 녹음, Howard Geisel 연주(바이올린 혼자, 2006).
        # CC BY 4.0. 원본 WAV는 로그인해야 받을 수 있어 공개 고음질 미리듣기(Vorbis 198k)를 쓴다.
        # https://freesound.org/people/FreqMan/sounds/25481/ → https://cdn.freesound.org/previews/25/25481_92661-hq.ogg
        "sources": [(RAW_BASE, "프리사운드-25481-violin_minuet_boccherini-hq.ogg")],
        "out": (WESTERN_DIR, "바이올린-보케리니.mp3"),
        "start": 0.0,
        "end": 15.5,
        # 1 m 떨어진 마이크 두 개라 좌우가 서로 어긋나(상관 -0.30) 스피커 하나로 들으면 얇아진다 → 왼쪽만 양쪽으로.
        "pan": "stereo|c0=c0|c1=c0",
        "channels": 2,
        "fade_in": 0.01,
        "fade_out": 0.6,
        "target_lufs": -18,
    },
    {
        "label": "더블베이스 · 보테시니 '몽유병의 여인' 환상곡",
        # 루마니아 방송(Societatea Română de Radiodifuziune) 아카이브 DVD-FM-279 — Răzvan Popescu(더블베이스),
        # Viorica Boerescu(피아노), 루마니아 아테네움 소강당 실황 2011-04-19. CC BY-SA 4.0(Europeana 937/Culturalia_03a8a6a1…).
        # https://resource.culturalia.ro/public/2000/01/01/_Z:/B-SRR/2021/Februarie/Diana/DVD_FM-279_02.mp3
        "sources": [(RAW_BASE, "라디오루마니아-DVD_FM-279_02-Bottesini_La_Sonnambula.mp3")],
        "out": (WESTERN_DIR, "더블베이스-보테시니.mp3"),
        "start": 33.3,  # 무음에서 길고 낮은 활 소리로 들어와 높은 음으로 올라갔다 무음으로 끝나는 한 악구.
        "end": 49.4,
        "channels": 2,
        "fade_in": 0.05,
        "fade_out": 0.6,
        "target_lufs": -18,
    },
]


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def input_args(example):
    args = []
    for parts in example["sources"]:
        args += ["-i", os.path.join(*parts)]
    return args


def filter_graph(example, gain_db=None):
    """원본들을 같은 형식으로 맞춰 잇고 → 구간 자르기 → (음량) → 페이드."""
    layout = "mono" if example.get("channels", 1) == 1 else "stereo"
    count = len(example["sources"])
    steps = [
        f"[{i}:a]aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts={layout}[s{i}]"
        for i in range(count)
    ]
    joined = "".join(f"[s{i}]" for i in range(count))
    start, end = example["start"], example["end"]
    chain = [f"concat=n={count}:v=0:a=1", f"atrim=start={start}:end={end}", "asetpts=PTS-STARTPTS"]
    if example.get("pan"):
        chain.append(f"pan={example['pan']}")
    if example.get("highpass"):
        chain.append(f"highpass=f={example['highpass']}")
    if gain_db is not None:
        chain.append(f"volume={gain_db:.2f}dB")
    chain.append(f"afade=t=in:st=0:d={example['fade_in']}")
    chain.append(f"afade=t=out:st={max(0.0, end - start - example['fade_out']):.3f}:d={example['fade_out']}")
    return ";".join(steps + [joined + ",".join(chain) + "[out]"])


def summary_of(stderr):
    summary = stderr.split("Summary:")[-1]
    lufs = re.search(r"I:\s+(-?[\d.]+) LUFS", summary)
    peak = re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary)
    if not lufs or not peak:
        raise RuntimeError(f"음량 측정 실패\n{stderr[-800:]}")
    return float(lufs.group(1)), float(peak.group(1))


def measure_graph(example):
    """다듬기 전(음량 조절 전) 통합 음량·트루피크."""
    graph = filter_graph(example).replace("[out]", ",ebur128=peak=true[out]")
    result = run(["ffmpeg", "-nostats", "-hide_banner", *input_args(example), "-filter_complex", graph, "-map", "[out]", "-f", "null", "-"])
    return summary_of(result.stderr)


def measure_file(path):
    result = run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"])
    return summary_of(result.stderr)


def build(example):
    missing = [os.path.join(*parts) for parts in example["sources"] if not os.path.exists(os.path.join(*parts))]
    if missing:
        print(f"  건너뜀 {example['label']}: 원본 없음 {missing[0]}")
        return None
    out = os.path.join(*example["out"])
    before_lufs, before_peak = measure_graph(example)
    gain_db = example["target_lufs"] - before_lufs
    held_back = max(0.0, before_peak + gain_db - PEAK_CEILING_DB)
    gain_db -= held_back
    os.makedirs(os.path.dirname(out), exist_ok=True)
    result = run(
        ["ffmpeg", "-v", "error", "-y", *input_args(example), "-filter_complex", filter_graph(example, gain_db), "-map", "[out]"]
        + ["-ac", str(example.get("channels", 1)), "-ar", str(SAMPLE_RATE), "-c:a", "libmp3lame", "-b:a", BITRATE, out]
    )
    if result.returncode != 0:
        raise RuntimeError(f"인코딩 실패: {out}\n{result.stderr[-800:]}")
    after_lufs, after_peak = measure_file(out)
    note = f", 피크 때문에 {held_back:.1f} dB 덜 키움" if held_back > 0 else ""
    print(
        f"  {example['label']}: {len(example['sources'])}개 원본 {example['start']}~{example['end']}s "
        f"→ {os.path.relpath(out, PROJECT_DIR)}  {after_lufs:.1f} LUFS (목표 {example['target_lufs']}), "
        f"피크 {after_peak:.1f} dBFS{note}"
    )
    return out


def main():
    only = {s.strip() for s in os.environ.get("BUILD_ONLY", "").split(",") if s.strip()}
    print("악기 감상 연주곡 다듬기")
    for example in EXAMPLES:
        if only and example["label"] not in only:
            continue
        build(example)


if __name__ == "__main__":
    main()
