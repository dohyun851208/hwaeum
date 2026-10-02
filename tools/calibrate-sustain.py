"""Calibrate checked-in MP3s from measure-sustain.cjs output (numpy + scipy).

node tools/measure-sustain.cjs <directory> --uncalibrated
python tools/calibrate-sustain.py <directory> --write
Without --write this only reports the residual pitch/seam measurements.
The original Philharmonia archive is not required. Never alters alias cents.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.signal import correlate, find_peaks


def pitch(x, expected, sr):
    x = x.astype(np.float64)
    x -= x.mean()
    ac = correlate(x, x, mode='full', method='fft')[len(x)-1:]
    energy = np.r_[0, np.cumsum(x*x)]
    lags = np.arange(1, min(len(x)//2, int(sr/30)))
    denominator = np.sqrt(energy[len(x)-lags] * (energy[-1]-energy[lags]))
    corr = ac[lags] / np.maximum(denominator, 1e-20)
    peaks = find_peaks(corr)[0]
    near = [k for k in peaks if .8*sr/expected < k+1 < 1.25*sr/expected]
    if not near:
        return None
    k = max(near, key=lambda v: corr[v])
    den = corr[k-1]-2*corr[k]+corr[k+1]
    delta = .5*(corr[k-1]-corr[k+1])/den if den else 0
    hz = sr/(k+1+delta)
    # Independent wide-range YIN candidate, without an expected-note search limit.
    difference = np.maximum(0, energy[len(x)-lags] + energy[-1]-energy[lags] - 2*ac[lags])
    yin = difference * lags / np.maximum(np.cumsum(difference), 1e-20)
    minima = find_peaks(-yin)[0]
    candidates = [j for j in minima if j+1 > sr/4000 and yin[j] < .2]
    wide = sr/(candidates[0]+1) if candidates else None
    # Harmonics verify the expected octave even if its fundamental is weak.
    nfft = 131072
    spectrum = np.abs(np.fft.rfft(x*np.hanning(len(x)), nfft))
    harmonics = []
    for h in range(1, min(12, int(sr*.45/expected))+1):
        lo = max(1, int(expected*h*2**(-1/12)*nfft/sr))
        hi = min(len(spectrum)-1, int(expected*h*2**(1/12)*nfft/sr))
        p = lo + np.argmax(spectrum[lo:hi])
        if p <= lo or p >= hi-1:
            continue
        z = np.log(np.maximum(spectrum[p-1:p+2], 1e-20))
        d = .5*(z[0]-z[2])/(z[0]-2*z[1]+z[2])
        harmonics.append((float(spectrum[p]), float((p+d)*sr/nfft/h), h))
    harmonics.sort(reverse=True)
    if not harmonics:
        return None
    fft_hz = harmonics[0][1]
    wide_agrees = wide is not None and abs(1200*np.log2(hz/wide)) < 15
    # 비브라토의 가장 큰 FFT 봉우리는 중심에서 벗어날 수 있다. 높은 주기성,
    # 넓은 YIN 탐색, 아래의 이웃 배음 검증이 함께 맞을 때만 이 경우를 허용한다.
    consistent = corr[k] > .7 and (abs(1200*np.log2(hz/fft_hz)) < 15 or (wide_agrees and corr[k] > .9))
    # Adjacent harmonic orders prevent blindly folding wide-YIN octave errors.
    strong = [h for amplitude, f, h in harmonics if amplitude > harmonics[0][0]*.08 and abs(1200*np.log2(f/hz)) < 20]
    octave_supported = 1 in strong or any(a+1 in strong for a in strong)
    return dict(hz=float(hz), confidence=float(corr[k]), fftHz=fft_hz,
                wideHz=wide, octaveSupported=octave_supported, valid=bool(consistent and octave_supported))


def analyze(directory, write=False):
    payload = json.loads((directory/'cells.json').read_text('utf-8'))
    sr = payload['sampleRate']
    rows = []
    sources = {}
    for cell in payload['cells']:
        x = np.fromfile(directory/'pcm'/cell['pcm'], dtype='<f4')
        looping = cell['live']['loop']
        s = round(cell['live']['loopStart']*sr) if looping else round(.05*sr)
        e = round(cell['live']['loopEnd']*sr) if looping else min(len(x), round(.5*sr))
        expected = cell['expectedHz']/cell['rate']
        samples = [pitch(x[i:i+round(.18*sr)], expected, sr) for i in range(s, max(s+1, e-round(.18*sr)), round(.04*sr))]
        good = [v for v in samples if v and v['valid']]
        hz = float(np.median([v['hz'] for v in good])) if good else None
        cents = float(1200*np.log2(hz*cell['rate']/cell['expectedHz'])) if hz else None
        loop = x[s:e].astype(np.float64)
        levels = [float(10*np.log10(np.mean(loop[i:i+round(.05*sr)]**2)+1e-24)) for i in range(0, len(loop)-round(.05*sr), round(.025*sr))]
        seam = float(abs(loop[0]-2*loop[-1]+loop[-2])/(np.percentile(abs(np.diff(loop, n=2)), 99)+1e-20)) if looping else None
        row = dict(id=cell['id'], uiMidi=cell['uiMidi'], cents=cents, hz=hz, validWindows=len(good),
                   centsSpread=float(np.percentile([1200*np.log2(v['hz']/hz) for v in good],90)-np.percentile([1200*np.log2(v['hz']/hz) for v in good],10)) if good else None,
                   wideOctaveDisagreements=int(sum(v['wideHz'] is not None and abs(1200*np.log2(v['wideHz']/v['hz'])) > 600 for v in good)),
                   seamP99Ratio=seam, loopRangeDb=max(levels)-min(levels) if levels else None,
                   loopSeconds=(e-s)/sr if looping else None, duration=len(x)/sr)
        rows.append(row)
        key = cell['src'] if cell['multi'] else cell['src']+'@'+str(cell['segment']['offset'])
        if hz:
            entry = sources.setdefault(cell['id'], {}).setdefault(key, dict(hz=[], cents=[]))
            entry['hz'].append(hz)
            entry['cents'].append(cents)
    profiles = {}
    for instrument, values in sources.items():
        common = float(np.median([np.median(v['cents']) for v in values.values()]))
        profiles[instrument] = dict(commonCents=round(common, 3), sources={k: dict(hz=round(float(np.median(v['hz'])), 6), residualCents=round(float(np.median(v['cents']))-common, 3)) for k,v in values.items()})
    (directory/'analysis.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    for instrument in profiles:
        rr = [r for r in rows if r['id']==instrument]
        print(instrument, 'cents', [round(r['cents'],1) if r['cents'] is not None else None for r in rr], 'max seam', round(max((r['seamP99Ratio'] or 0 for r in rr)),2), 'short', sum(0<(r['loopSeconds'] or 0)<.9 for r in rr))
    if write:
        if any(r['hz'] is None for r in rows):
            raise RuntimeError('Uncertain pitch rows; inspect analysis.json before applying calibration')
        target = Path(__file__).resolve().parents[1]/'js/sample-calibration.js'
        text = target.read_text('utf-8')
        a = text.index('  const profiles = ')
        b = text.index('\n  Object.keys(profiles)', a)
        text = text[:a]+'  const profiles = '+json.dumps(profiles, ensure_ascii=False, indent=2)+text[b:]
        target.write_text(text, encoding='utf-8')
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    analyze(args.directory, args.write)
