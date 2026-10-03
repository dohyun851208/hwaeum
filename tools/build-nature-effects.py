# -*- coding: utf-8 -*-
"""
build-nature-effects.py — 자연 효과음 도장 음원 다듬기 도구

효과음 도장은 고를 때·찍을 때 **앞 1.2초만** 미리 들려주고(audio-engine.js `_playEffectBufferPreview`),
전체 재생에서는 찍은 자리에서 **파일 0초부터** 튼다. 그래서 이름에 맞는 순간(천둥이 치는 순간,
잎이 흔들리는 순간)이 파일 맨 앞에 와야 학생이 고른 이름대로 들린다.
또 모든 효과음은 같은 gain(EFFECT_GAIN)으로 재생되므로 **파일 음량이 곧 앱 속 음량**이다.

이 도구는 원본을 자르고(앞부분 정리) → 필터 → 페이드 → 이름에 맞는 음량(LUFS)으로 맞춘 뒤
라벨 이름의 MP3(모노 44.1kHz 128k)로 쓴다. 출처와 다듬은 방식은 아래 EFFECTS 표가 기록이다.

실행:
  python tools/build-nature-effects.py
  PIXABAY_RAW_BASE="<픽사베이 원본 폴더>" python tools/build-nature-effects.py

픽사베이 원본은 배포 트리 밖에 둔다(vercel --prod 가 작업 트리를 통째로 올리므로).
기본 위치는 저장소 옆 `효과-자연음(픽사베이)-원본/` 이고, 받을 주소는 각 폴더의 라이센스.txt 에 있다.
원본이 없는 항목은 건너뛴다. ffmpeg 필요.
"""

import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(HERE)
YUJA_DIR = os.path.join(PROJECT_DIR, "sound", "효과-자연음(유자레코즈)")
PIXABAY_DIR = os.path.join(PROJECT_DIR, "sound", "효과-자연음(픽사베이)")
PIXABAY_RAW_BASE = os.environ.get("PIXABAY_RAW_BASE") or os.path.join(
    os.path.dirname(PROJECT_DIR), "효과-자연음(픽사베이)-원본"
)

LIMIT_DB = -1.0
TRUE_PEAK_LIMIT = 10 ** (LIMIT_DB / 20)
OUTPUT_ARGS = ["-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k"]

# 목표 음량은 이름의 뜻을 따른다: 산들바람 < 거센바람, 먼 천둥 < 우르릉 < 번개.
# 기존 도장들(새 -14, 뻐꾸기 -17, 하프 -23, 소나기 -25 LUFS)과 같은 범위에 둔다.
EFFECTS = [
    {
        "label": "산들바람",
        "src": (YUJA_DIR, "바람2.mp3"),  # 조용하고 고른 바람. 원래 거센바람 자리에 있었다.
        "out": (YUJA_DIR, "산들바람.mp3"),
        "start": 0.0,
        "end": 7.8,
        "fade_in": 0.3,
        "fade_out": 0.8,
        "target_lufs": -26,
    },
    {
        "label": "거센바람",
        "src": (YUJA_DIR, "바람1.mp3"),  # 15 dB 더 크고 낮게 울부짖는 바람. 원래 산들바람 자리에 있었다.
        "out": (YUJA_DIR, "거센바람.mp3"),
        "start": 0.0,
        "end": 4.47,  # 4.47초에서 큰 소리 그대로 뚝 끊기는 원본 끝을 페이드로 닫는다.
        "fade_in": 0.05,
        "fade_out": 0.45,
        "target_lufs": -19,
    },
    {
        "label": "회오리바람",
        "src": (YUJA_DIR, "바람3.mp3"),  # 휘이잉 우는 바람(1 kHz 휘파람 성분).
        "out": (YUJA_DIR, "회오리바람.mp3"),
        "start": 0.5,  # 앞 0.5초는 -36 dB에서 올라오는 구간이라 미리듣기에 거의 안 들린다.
        "end": 9.2,
        "fade_in": 0.15,
        "fade_out": 0.6,
        "target_lufs": -20,
    },
    {
        "label": "폭풍우",
        "src": (YUJA_DIR, "천둥3.mp3"),  # 빗소리 + 3.12초에 큰 천둥.
        "out": (YUJA_DIR, "폭풍우.mp3"),
        "start": 2.6,  # 빗소리 0.5초 뒤 바로 천둥이 치게 앞 2.6초를 덜어 낸다.
        "end": 10.6,
        "fade_in": 0.1,
        "fade_out": 1.5,
        "target_lufs": -18,
    },
    {
        "label": "번개",
        "src": (YUJA_DIR, "천둥2.mp3"),  # 높은 음역까지 번쩍 갈라지는 소리 + 우르릉 꼬리.
        "out": (YUJA_DIR, "번개.mp3"),
        "start": 0.08,  # 앞 80 ms 무음을 덜어 찍은 자리에서 바로 친다.
        "end": 6.75,
        "fade_in": 0.003,
        "fade_out": 0.6,
        "target_lufs": -18,  # 갈라지는 첫 소리가 리미터에 2 dB 안쪽으로만 눌리게.
    },
    # 아래는 유자레코즈 음원에 그 소리가 없어 픽사베이에서 가져온 것(출처: 효과-자연음(픽사베이)/라이센스.txt).
    {
        "label": "흔들리는 잎",
        "src": (PIXABAY_RAW_BASE, "rustling-leaves-6875.mp3"),  # 잎이 바스락 부딪히는 알갱이가 촘촘하다.
        "out": (PIXABAY_DIR, "흔들리는잎.mp3"),
        "start": 7.0,  # 앞쪽보다 바스락이 큰 구간.
        "end": 15.0,
        "fade_in": 0.2,
        "fade_out": 1.0,
        "target_lufs": -24,
    },
    {
        "label": "깊은 숲",
        "src": (PIXABAY_RAW_BASE, "forest-wind-with-birds-and-crickets-438060.mp3"),  # 나무 사이 바람 + 먼 새 + 풀벌레.
        "out": (PIXABAY_DIR, "깊은숲.mp3"),
        "start": 15.0,  # 0.5초 뒤 먼 새소리가 시작되고, 22.4초 마이크 바람 소리 전에 끝낸다.
        "end": 22.2,
        "highpass": 120,  # 마이크에 부딪힌 바람의 웅웅거림만 덜어 낸다.
        "fade_in": 0.4,
        "fade_out": 1.2,
        "target_lufs": -23,
    },
    {
        "label": "큰 빗방울",
        "src": (PIXABAY_RAW_BASE, "big-rain-drops-2-6824.mp3"),  # 굵은 물방울이 하나하나 똑똑 떨어진다.
        "out": (PIXABAY_DIR, "큰빗방울.mp3"),
        "start": 0.0,
        "end": 9.9,
        "highpass": 80,
        "fade_in": 0.05,
        "fade_out": 0.8,
        # 물방울은 피크가 평균보다 30 dB 높다. 더 키우면 리미터가 '똑' 하는 머리를 깎아 뭉개진다(-22 목표 때 7.8 dB).
        "target_lufs": -27,
    },
    {
        "label": "먼 천둥",
        "src": (PIXABAY_RAW_BASE, "distant-thunder-320067.mp3"),  # 높은 소리가 없는(5 kHz 이하) 먼 우르르.
        "out": (PIXABAY_DIR, "먼천둥.mp3"),
        "start": 0.0,
        "end": 7.5,
        "highpass": 25,
        "fade_in": 0.3,  # 멀리서 오는 소리라 시작을 부드럽게.
        "fade_out": 1.5,
        "target_lufs": -25,
    },
    {
        "label": "우르릉",
        "src": (PIXABAY_RAW_BASE, "rolling-thunder-534181.mp3"),  # 쉬지 않고 굴러가는 긴 천둥.
        "out": (PIXABAY_DIR, "우르릉.mp3"),
        "start": 0.0,
        "end": 9.5,
        "highpass": 25,
        "fade_in": 0.1,
        "fade_out": 2.0,
        "target_lufs": -19,
    },
]


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def channel_count(path):
    result = run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", path])
    return int(result.stdout.strip() or 1)


def filter_chain(effect, channels=1):
    start = effect["start"]
    end = effect["end"]
    length = end - start
    parts = [f"atrim=start={start}:end={end}", "asetpts=PTS-STARTPTS"]
    if channels == 2:
        # 앱은 모노로 재생한다. 받은 스테레오 원본은 좌우 시간차가 없어(상관 0.5~0.95, 지연 0 ms) 평균해도 뭉개지지 않는다.
        parts.append("pan=mono|c0=0.5*c0+0.5*c1")
    if effect.get("highpass"):
        # highpass_stages: 12 dB/oct 필터를 몇 번 겹칠지. 마이크 바람이 소리보다 30 dB 넘게 큰 원본은 2.
        for _ in range(effect.get("highpass_stages", 1)):
            parts.append(f"highpass=f={effect['highpass']}")
    if effect.get("lowpass"):
        parts.append(f"lowpass=f={effect['lowpass']}")
    parts.append(f"afade=t=in:st=0:d={effect['fade_in']}")
    parts.append(f"afade=t=out:st={max(0.0, length - effect['fade_out']):.3f}:d={effect['fade_out']}")
    return parts


def measure(path, chain=None):
    """ebur128 통합 음량(LUFS)·트루피크(dBFS)."""
    graph = ",".join((chain or []) + ["ebur128=peak=true"])
    result = run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", graph, "-f", "null", "-"])
    summary = result.stderr.split("Summary:")[-1]
    lufs = re.search(r"I:\s+(-?[\d.]+) LUFS", summary)
    peak = re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary)
    if not lufs or not peak:
        raise RuntimeError(f"음량 측정 실패: {path}\n{result.stderr[-800:]}")
    return float(lufs.group(1)), float(peak.group(1))


def build(effect):
    src = os.path.join(*effect["src"])
    out = os.path.join(*effect["out"])
    if not os.path.exists(src):
        print(f"  건너뜀 {effect['label']}: 원본 없음 {src}")
        return None
    chain = filter_chain(effect, channel_count(src))
    before_lufs, before_peak = measure(src, chain)
    gain_db = effect["target_lufs"] - before_lufs
    # 리미터가 깎는 양. 빗방울·번개처럼 순간 피크가 핵심인 소리는 3 dB 안쪽이어야 '똑'·'콰' 머리가 산다.
    limited_db = max(0.0, before_peak + gain_db - LIMIT_DB)
    final_chain = chain + [
        f"volume={gain_db:.2f}dB",
        f"alimiter=limit={TRUE_PEAK_LIMIT:.4f}:attack=1:release=80:level=0:latency=1",
    ]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    result = run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", ",".join(final_chain)] + OUTPUT_ARGS + [out])
    if result.returncode != 0:
        raise RuntimeError(f"인코딩 실패: {out}\n{result.stderr[-800:]}")
    after_lufs, after_peak = measure(out)
    print(
        f"  {effect['label']}: {os.path.basename(src)} {effect['start']}~{effect['end']}s "
        f"→ {os.path.relpath(out, PROJECT_DIR)}  {after_lufs:.1f} LUFS (목표 {effect['target_lufs']}), "
        f"피크 {after_peak:.1f} dBFS, 리미터 {limited_db:.1f} dB"
    )
    return out


def main():
    only = {s.strip() for s in os.environ.get("BUILD_ONLY", "").split(",") if s.strip()}
    print("자연 효과음 다듬기")
    for effect in EFFECTS:
        if only and effect["label"] not in only:
            continue
        build(effect)


if __name__ == "__main__":
    main()
