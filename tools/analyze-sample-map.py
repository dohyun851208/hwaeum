# -*- coding: utf-8 -*-
"""analyze-sample-map.py — 국악 단일음/음계 녹음을 분석해 js/sample-maps.js 형식의 구간 맵을 생성한다.

순수 stdlib(numpy 불필요). RMS 포락선으로 음(note) 구간을 찾고, 각 구간 안정부에서
자기상관(autocorrelation)으로 기본주파수(f0)를 검출한다. 옥타브 오검출 보정 포함.

사용:
    python tools/analyze-sample-map.py "<wav 경로>" [--fmin 180] [--fmax 1400] [--ratio 0.18]

출력: midi/note/offset/duration/detectedHz/confidence/cents 가 담긴 sampleMap JS 배열 + 요약.
연주곡처럼 음이 끊임없이 이어지는 녹음은 구간이 깨끗하게 안 잘려 결과가 들쭉날쭉 → 샘플 소스로 부적합 신호.
"""
import struct, math, glob, sys, json, statistics

def read_mono(path):
    with open(path, "rb") as f:
        if f.read(4) != b"RIFF":
            raise SystemExit("not RIFF: %s" % path)
        f.read(8)  # size + 'WAVE'
        fmt_tag = ch = fr = sw = None
        data = None
        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            cid, csize = hdr[0:4], struct.unpack("<I", hdr[4:8])[0]
            body = f.read(csize)
            if csize % 2 == 1:
                f.read(1)
            if cid == b"fmt ":
                fmt_tag, ch, fr, _, _, bits = struct.unpack("<HHIIHH", body[:16]); sw = bits // 8
            elif cid == b"data":
                data = body
            if data is not None and fmt_tag is not None:
                break
    if fmt_tag == 3 and sw == 4:
        s = struct.unpack("<%df" % (len(data)//4), data); scale = 1.0
    elif fmt_tag == 1 and sw == 2:
        s = struct.unpack("<%dh" % (len(data)//2), data); scale = 32768.0
    elif fmt_tag == 1 and sw == 1:
        s = [b-128 for b in data]; scale = 128.0
    elif fmt_tag == 1 and sw == 3:
        s = []
        for i in range(0, len(data)-2, 3):
            v = data[i] | (data[i+1]<<8) | (data[i+2]<<16)
            if v & 0x800000: v -= 0x1000000
            s.append(v)
        scale = 8388608.0
    else:
        raise SystemExit("unsupported fmt_tag=%s sw=%s" % (fmt_tag, sw))
    if ch and ch > 1:
        mono = [sum(s[i:i+ch])/ch/scale for i in range(0, len(s)-ch+1, ch)]
    else:
        mono = [v/scale for v in s]
    return mono, fr

def rms_env(x, fr, win=0.03, hop=0.01):
    wlen = int(fr*win); hlen = int(fr*hop); env = []
    for st in range(0, len(x)-wlen, hlen):
        ssum = 0.0
        for i in range(st, st+wlen):
            ssum += x[i]*x[i]
        env.append((st/fr, math.sqrt(ssum/wlen)))
    return env

def segments(env, peak, ratio=0.18, min_dur=0.18, gap=0.06):
    thr = peak*ratio; segs = []; cur = None; last = None
    for t, v in env:
        if v >= thr:
            if cur is None: cur = [t, t]
            cur[1] = t; last = t
        elif cur is not None and (t-last) > gap:
            if cur[1]-cur[0] >= min_dur: segs.append(tuple(cur))
            cur = None
    if cur is not None and cur[1]-cur[0] >= min_dur: segs.append(tuple(cur))
    return segs

def autocorr_f0(x, fr, fmin, fmax):
    m = sum(x)/len(x); x = [v-m for v in x]; n = len(x)
    a = int(fr/fmax); b = int(fr/fmin); e0 = sum(v*v for v in x) or 1e-12
    vals = [sum(x[i]*x[i+lag] for i in range(0, n-lag))/e0 for lag in range(a, min(b, n-1))]
    if not vals: return None, 0.0
    bi = max(range(len(vals)), key=lambda i: vals[i]); thr = vals[bi]*0.85; ci = bi
    for i in range(1, len(vals)-1):
        if vals[i] >= thr and vals[i] > vals[i-1] and vals[i] >= vals[i+1]:
            ci = i; break
    aa = vals[ci-1] if ci > 0 else vals[ci]; bb = vals[ci]; cc = vals[ci+1] if ci+1 < len(vals) else vals[ci]
    den = aa-2*bb+cc; sh = 0.5*(aa-cc)/den if den else 0
    return fr/((a+ci)+sh), bb

NN = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
def name(m): r = int(round(m)); return "%s%d" % (NN[r%12], r//12 - 1)

def detect_pitch(x, fr, t0, seglen, fmin, fmax):
    # 안정성을 위해 구간 중앙부 여러 창의 median
    hz = []
    for frac in (0.35, 0.45, 0.55, 0.65):
        c = t0 + seglen*frac
        i0 = int(c*fr); i1 = i0 + int(0.15*fr)
        if i1 <= len(x) and i1-i0 > int(fr*0.04):
            f, conf = autocorr_f0(x[i0:i1], fr, fmin, fmax)
            if f: hz.append((f, conf))
    if not hz: return None
    med = statistics.median([h for h, _ in hz])
    conf = statistics.median([c for _, c in hz])
    return med, conf

def main():
    args = [a for a in sys.argv[1:]]
    opts = {"fmin": 180.0, "fmax": 1400.0, "ratio": 0.18}
    path = None
    i = 0
    while i < len(args):
        if args[i] in ("--fmin", "--fmax", "--ratio"):
            opts[args[i][2:]] = float(args[i+1]); i += 2
        else:
            path = args[i]; i += 1
    if not path:
        raise SystemExit("usage: analyze-sample-map.py <wav> [--fmin N --fmax N --ratio N]")
    matches = glob.glob(path)
    if matches: path = matches[0]
    x, fr = read_mono(path)
    print("FILE: %s" % path)
    print("rate=%d dur=%.1fs peak=%.3f" % (fr, len(x)/fr, max(abs(v) for v in x)))
    env = rms_env(x, fr); peak = max(v for _, v in env) if env else 0
    segs = segments(env, peak, ratio=opts["ratio"])
    print("segments=%d" % len(segs))
    rows = []
    for t0, t1 in segs:
        seglen = t1-t0
        r = detect_pitch(x, fr, t0, seglen, opts["fmin"], opts["fmax"])
        if not r: continue
        f, conf = r; m = 69+12*math.log2(f/440.0); mr = int(round(m))
        rows.append({"midi": mr, "note": name(m), "offset": round(t0, 3),
                     "duration": round(min(seglen, 2.4), 3), "detectedHz": round(f, 2),
                     "confidence": round(conf, 3), "cents": int(round((m-mr)*100))})
    midis = [r["midi"] for r in rows]
    print("range: %s..%s  (%d notes, %.1f octaves)" % (
        name(min(midis)) if midis else "-", name(max(midis)) if midis else "-",
        len(rows), (max(midis)-min(midis))/12.0 if midis else 0))
    for r in rows:
        print("      { midi: %d, note: \"%s\", offset: %s, duration: %s, detectedHz: %s, confidence: %s, cents: %d }," % (
            r["midi"], r["note"], r["offset"], r["duration"], r["detectedHz"], r["confidence"], r["cents"]))
    print("RAW_JSON:" + json.dumps(rows, ensure_ascii=False))

if __name__ == "__main__":
    main()
