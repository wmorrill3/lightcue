# Song analysis for light-show choreography. numpy only (no librosa).
# usage: python3 -I analyze.py <audio file> > analysis.json
# Everything runs on a 50 fps grid (20 ms) = the light show step time, so frame i here == frame i in the .fseq.
import json, subprocess, sys
import numpy as np

SR = 22050
HOP = 441            # 20 ms at 22050 Hz
NFFT = 2048
FPS = SR / HOP       # 50.0


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-protocol_whitelist', 'file', '-format_whitelist', 'mp3,wav,flac,ogg,mov,mp4,m4a,aac,matroska,webm,aiff,w64', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def stft_mag(y):
    pad = NFFT // 2
    y = np.pad(y, (pad, pad), mode='reflect')
    n = 1 + (len(y) - NFFT) // HOP
    win = np.hanning(NFFT).astype(np.float32)
    out = np.empty((n, NFFT // 2 + 1), dtype=np.float32)
    for s in range(0, n, 2048):  # chunked to keep memory flat on long songs
        e = min(n, s + 2048)
        idx = np.arange(NFFT)[None, :] + HOP * np.arange(s, e)[:, None]
        out[s:e] = np.abs(np.fft.rfft(y[idx] * win, axis=1))
    return out


def norm01(x, lo=5, hi=98):
    a, b = np.percentile(x, lo), np.percentile(x, hi)
    return np.clip((x - a) / (b - a + 1e-9), 0, 1)


def smooth(x, n):
    if n <= 1: return x
    k = np.hanning(n * 2 + 1); k /= k.sum()
    return np.convolve(x, k, mode='same')


def flux(m):
    lm = np.log1p(10 * m)
    d = np.diff(lm, axis=0, prepend=lm[:1])
    return np.maximum(d, 0).sum(axis=1)


def tempo(onset):
    # autocorrelation of the onset envelope, weighted toward ~120 BPM (log-gaussian prior)
    o = onset - onset.mean()
    ac = np.correlate(o, o, mode='full')[len(o) - 1:]
    lags = np.arange(len(ac))
    bpm = 60 * FPS / np.maximum(lags, 1)
    ok = (bpm >= 60) & (bpm <= 200)
    w = np.exp(-0.5 * (np.log2(bpm / 120) / 0.9) ** 2)
    score = np.where(ok, ac * w, -np.inf)
    lag = int(np.argmax(score))
    # refine with parabolic interpolation
    if 1 <= lag < len(ac) - 1:
        a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
        p = 0.5 * (a - c) / (a - 2 * b + c + 1e-9)
        lagf = lag + float(np.clip(p, -0.5, 0.5))
    else:
        lagf = float(lag)
    return 60 * FPS / lagf, lagf


def beat_track(onset, period, tightness=100):
    # Ellis 2007 dynamic-programming beat tracker
    n = len(onset)
    o = onset / (onset.std() + 1e-9)
    score = o.copy(); back = -np.ones(n, dtype=int)
    lo, hi = int(round(period / 2)), int(round(period * 2))
    for i in range(n):
        a, b = max(0, i - hi), i - lo
        if b <= a: continue
        prev = np.arange(a, b)
        pen = -tightness * (np.log((i - prev) / period)) ** 2
        cand = score[prev] + pen
        j = int(np.argmax(cand))
        score[i] = o[i] + cand[j]; back[i] = prev[j]
    # start from the best score in the last period
    tail = max(0, n - int(period))
    i = tail + int(np.argmax(score[tail:]))
    beats = []
    while i >= 0:
        beats.append(i); i = back[i]
    beats = np.array(beats[::-1])
    # trim weak beats at the edges (silence at start/end)
    thr = 0.15 * np.median(o[beats]) if len(beats) else 0
    keep = np.where(o[beats] > thr)[0]
    if len(keep): beats = beats[keep[0]:keep[-1] + 1]
    return beats


def chroma(m):
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    ok = (freqs > 55) & (freqs < 4000)
    pc = (np.round(12 * np.log2(freqs[ok] / 440)) % 12).astype(int)
    c = np.zeros((m.shape[0], 12), dtype=np.float32)
    for k in range(12): c[:, k] = m[:, ok][:, pc == k].sum(axis=1)
    return c / (np.linalg.norm(c, axis=1, keepdims=True) + 1e-9)


def sections(feat, energy, bar_frames, n):
    # novelty on a checkerboard kernel over a bar-synchronous self-similarity matrix, boundaries snapped to bars
    if len(bar_frames) < 6:
        return [(0, n)]
    bars = np.array(list(bar_frames) + [n])
    B = np.array([feat[bars[i]:bars[i + 1]].mean(axis=0) for i in range(len(bars) - 1)])
    B = B / (np.linalg.norm(B, axis=1, keepdims=True) + 1e-9)
    S = B @ B.T
    L = 4
    k = np.ones((2 * L, 2 * L)); k[:L, L:] = -1; k[L:, :L] = -1
    nov = np.zeros(len(B))
    for i in range(L, len(B) - L):
        nov[i] = (S[i - L:i + L, i - L:i + L] * k).sum()
    # energy jumps count as boundaries too (drops)
    e = np.array([energy[bars[i]:bars[i + 1]].mean() for i in range(len(bars) - 1)])
    de = np.abs(np.diff(e, prepend=e[:1]))
    score = norm01(nov) + 1.5 * norm01(de)
    cut = [0]
    order = np.argsort(-score)
    for i in order:
        if score[i] < 0.6: break
        if all(abs(i - c) >= 4 for c in cut): cut.append(int(i))
    cut = sorted(cut)
    return [(int(bars[cut[j]]), int(bars[cut[j + 1]]) if j + 1 < len(cut) else n) for j in range(len(cut))]


def main(path):
    y = decode(path)
    dur = len(y) / SR
    m = stft_mag(y)
    n = m.shape[0]
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    band = lambda a, b: (freqs >= a) & (freqs < b)
    low, mid, high = band(30, 150), band(150, 2000), band(2000, 9000)
    rms = np.sqrt((m ** 2).mean(axis=1))
    energy = norm01(smooth(np.log1p(rms * 50), 25))   # ~0.5 s smoothing, perceptual
    f_low, f_mid, f_high = flux(m[:, low]), flux(m[:, mid]), flux(m[:, high])
    onset = norm01(f_low * 1.2 + f_mid + f_high * 0.8, 5, 99.5)
    bpm, period = tempo(smooth(onset, 1))
    beats = beat_track(onset, period)
    lowon = norm01(f_low, 5, 99.5)
    kickon = norm01(flux(m[:, band(40, 100)]), 5, 99.5)
    # the tracker can lock onto off-beat stabs (common in EDM/pop): the beat is where the kick is, so test the
    # half-beat-shifted grid against the low-band onsets and keep whichever the kick agrees with
    def kick_score(bs):
        bs = bs[(bs >= 1) & (bs < n - 1)]
        return np.mean([kickon[b - 1:b + 2].max() for b in bs]) if len(bs) else 0
    half = int(period // 2)
    scores = {o: kick_score(beats + o) for o in range(-half, half + 1)}
    best = max(scores, key=scores.get)
    if best and scores[best] > scores[0] * 1.15:
        beats = beats + best
        beats = beats[(beats >= 0) & (beats < n)]
    # downbeat phase: which of the 4 phases has the strongest low-band hits
    if len(beats) >= 8:
        ph = int(np.argmax([lowon[beats[p::4]].mean() for p in range(4)]))
    else:
        ph = 0
    downbeats = beats[ph::4]
    feat = np.hstack([chroma(m), np.stack([norm01(np.log1p(m[:, low].sum(1))), norm01(np.log1p(m[:, mid].sum(1))), norm01(np.log1p(m[:, high].sum(1)))], 1)])
    secs = sections(feat, energy, downbeats, n)
    sec_out = []
    for (a, b) in secs:
        e = float(energy[a:b].mean())
        sec_out.append({'start': round(a / FPS, 3), 'end': round(b / FPS, 3), 'f0': a, 'f1': b, 'energy': round(e, 3)})
    # rank energies into levels
    es = np.array([s['energy'] for s in sec_out])
    for i, s in enumerate(sec_out):
        rank = (es < s['energy']).mean() if len(es) > 1 else 0.5
        s['level'] = 'high' if s['energy'] > 0.62 or rank >= 0.75 and s['energy'] > 0.5 else 'low' if s['energy'] < 0.35 else 'mid'
        prev = sec_out[i - 1]['energy'] if i else 0
        s['drop'] = bool(i and s['energy'] - prev > 0.18 and s['level'] == 'high')
    # per-band transient peaks (kick / snare-ish / hat-ish) for accents
    def peaks(x, thr):
        x = norm01(x, 5, 99.5)
        p = (x > thr) & (x >= np.roll(x, 1)) & (x > np.roll(x, -1))
        idx = np.where(p)[0]
        out = []
        for i in idx:  # 80 ms refractory
            if not out or i - out[-1] >= 4: out.append(int(i))
        return out
    q = lambda x: [int(v) for v in np.round(np.clip(x, 0, 1) * 255)]
    json.dump({
        'version': 1, 'fps': FPS, 'duration': round(dur, 3), 'frames': n, 'bpm': round(float(bpm), 2),
        'beats': [int(b) for b in beats], 'downbeats': [int(b) for b in downbeats], 'sections': sec_out,
        'kicks': peaks(f_low, 0.45), 'snares': peaks(f_mid, 0.5), 'hats': peaks(f_high, 0.5),
        'energy': q(energy), 'low': q(norm01(smooth(np.log1p(m[:, low].sum(1)), 2))),
        'mid': q(norm01(smooth(np.log1p(m[:, mid].sum(1)), 2))), 'high': q(norm01(smooth(np.log1p(m[:, high].sum(1)), 2))),
        'onset': q(onset),
    }, sys.stdout, separators=(',', ':'))


if __name__ == '__main__':
    main(sys.argv[1])
