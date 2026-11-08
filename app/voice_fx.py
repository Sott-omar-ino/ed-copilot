"""Effetti sulla voce del copilota per la voce che parte dal PC (voice.say: avvisi, briefing, risposte ai comandi).

Le stesse ricette, con gli stessi numeri, sono in web/js/tts.js (WebAudio) per la voce riprodotta dall'interfaccia:
se ne cambi una, cambia anche l'altra.

Solo numpy (arriva con faster-whisper) e PyAV (dipendenza di faster-whisper, decodifica l'mp3 di edge-tts).
Senza le librerie la voce resta "Naturale".

Tecniche usate (tutte classiche, niente di proprietario):
- filtri biquad: formule di R. Bristow-Johnson, "Cookbook formulae for audio EQ biquad filter coefficients"
  (le stesse dei BiquadFilterNode della Web Audio API, che le cita nelle specifiche W3C);
- riverbero a convoluzione con risposta all'impulso sintetica (rumore che decade in modo esponenziale);
- modulazione ad anello (segnale × sinusoide a bassa frequenza: il classico suono "robot");
- bitcrush (riduzione dei bit e della frequenza di campionamento), chorus (copia ritardata con ritardo modulato),
  compressore con inviluppo RMS, distorsione morbida con tanh.
"""

import io
import math
import os
import wave

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

RATE = 24000  # edge-tts restituisce mp3 mono a 24 kHz

# Ogni effetto: nome mostrato, descrizione, spostamento di tono applicato già nella sintesi (edge-tts "pitch", Hz).
PRESETS = {
    "naturale": {"label": "Naturale", "desc": "La voce così com'è.", "pitch_hz": 0},
    "computer": {"label": "Computer di bordo", "desc": "Banda stretta e un filo di riverbero, come un altoparlante di plancia.", "pitch_hz": 0},
    "robotico": {"label": "Robotico", "desc": "Modulazione ad anello e campioni ridotti: voce metallica.", "pitch_hz": 0},
    "ia": {"label": "IA di bordo", "desc": "Assistente elegante: tono un po' più basso, voce raddoppiata, stanza piccola, compressa.", "pitch_hz": -8},
    "radio": {"label": "Radio", "desc": "Banda da ricetrasmittente, leggera distorsione e scatto dello squelch.", "pitch_hz": 0},
    "casco": {"label": "Casco", "desc": "Filtrata e chiusa, come dentro il casco della tuta.", "pitch_hz": 0},
}


# Nome e descrizione in inglese (gli id e PRESETS restano invariati: voice.py e l'interfaccia li usano così).
PRESETS_EN = {
    "naturale": {"label": "Natural", "desc": "The voice as it is."},
    "computer": {"label": "Ship computer", "desc": "Narrow band and a touch of reverb, like a bridge speaker."},
    "robotico": {"label": "Robotic", "desc": "Ring modulation and reduced samples: metallic voice."},
    "ia": {"label": "Ship AI", "desc": "Elegant assistant: slightly lower pitch, doubled voice, small room, compressed."},
    "radio": {"label": "Radio", "desc": "Transceiver band, light distortion and a squelch click."},
    "casco": {"label": "Helmet", "desc": "Filtered and closed in, like inside the suit's helmet."},
}


def presets():
    """Elenco per l'interfaccia ([{id, label, desc, pitch_hz}]) con nome e descrizione nella lingua scelta."""
    from .lang import is_en
    en = is_en()
    return [{"id": k, **v, **(PRESETS_EN.get(k, {}) if en else {})} for k, v in PRESETS.items()]


def available():
    return np is not None


def preset(name):
    return name if name in PRESETS else "naturale"


# --- Mattoni ---------------------------------------------------------------------------

def _biquad(kind, f0, q=0.7071, rate=RATE):
    """Coefficienti (b, a) normalizzati, formule del "Audio EQ Cookbook" (Bristow-Johnson)."""
    w0 = 2 * math.pi * f0 / rate
    alpha = math.sin(w0) / (2 * q)
    c = math.cos(w0)
    if kind == "lowpass":
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == "highpass":
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:  # bandpass, guadagno 0 dB al centro
        b = [alpha, 0.0, -alpha]
    a = [1 + alpha, -2 * c, 1 - alpha]
    return [x / a[0] for x in b], [x / a[0] for x in a]


def _filter(x, kind, f0, q=0.7071):
    """Applica il biquad nel dominio della frequenza (risposta in ampiezza del filtro, fase nulla): veloce con solo numpy."""
    b, a = _biquad(kind, f0, q)
    n = 1 << int(math.ceil(math.log2(len(x) + 1024)))
    z = np.exp(-1j * np.linspace(0, math.pi, n // 2 + 1))
    h = (b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)
    return np.fft.irfft(np.fft.rfft(x, n) * np.abs(h), n)[:len(x)].astype(np.float32)


def _impulse(decay_s, seed=7):
    """Risposta all'impulso di una stanza: rumore con decadimento esponenziale (-60 dB in decay_s secondi)."""
    n = int(RATE * decay_s)
    t = np.arange(n) / RATE
    rng = np.random.default_rng(seed)
    ir = rng.standard_normal(n) * np.power(10.0, -3.0 * t / decay_s)
    return (ir / np.sqrt(np.sum(ir ** 2))).astype(np.float32)


def _reverb(x, decay_s, wet):
    ir = _impulse(decay_s)
    n = 1 << int(math.ceil(math.log2(len(x) + len(ir))))
    y = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[:len(x) + len(ir)]
    out = np.zeros(len(y), dtype=np.float32)
    out[:len(x)] = x
    return (out + wet * y).astype(np.float32)


def _ring(x, freq, depth):
    t = np.arange(len(x)) / RATE
    return (x * ((1 - depth) + depth * np.sin(2 * math.pi * freq * t))).astype(np.float32)


def _bitcrush(x, bits, hold):
    steps = 2 ** (bits - 1)
    y = np.round(x * steps) / steps
    if hold > 1:
        y = np.repeat(y[::hold], hold)[:len(x)]
    return y.astype(np.float32)


def _chorus(x, delay_ms=18.0, depth_ms=3.0, rate_hz=0.25, mix=0.35):
    i = np.arange(len(x), dtype=np.float64)
    d = (delay_ms + depth_ms * np.sin(2 * math.pi * rate_hz * i / RATE)) * RATE / 1000.0
    src = i - d
    lo = np.clip(np.floor(src).astype(np.int64), 0, len(x) - 1)
    hi = np.clip(lo + 1, 0, len(x) - 1)
    frac = (src - np.floor(src)).astype(np.float32)
    delayed = x[lo] * (1 - frac) + x[hi] * frac
    delayed[src < 0] = 0
    return (x + mix * delayed).astype(np.float32)


def _compress(x, threshold_db=-20.0, ratio=3.0, window_ms=10.0):
    n = max(1, int(RATE * window_ms / 1000))
    env = np.sqrt(np.convolve(x.astype(np.float64) ** 2, np.ones(n) / n, mode="same")) + 1e-9
    level = 20 * np.log10(env)
    over = np.maximum(0.0, level - threshold_db)
    gain = np.power(10.0, -(over - over / ratio) / 20.0)
    return (x * gain).astype(np.float32)


def _squelch(length, level=0.12, seed=3):
    """Scatto dello squelch a fine trasmissione: 70 ms di fruscio filtrato con un attacco netto."""
    n = int(RATE * 0.07)
    rng = np.random.default_rng(seed)
    burst = _filter(rng.standard_normal(n).astype(np.float32), "bandpass", 2000, 0.8)
    burst *= np.linspace(1, 0, n) ** 2 * level / (np.max(np.abs(burst)) + 1e-9)
    return burst.astype(np.float32)


# --- Ricette ------------------------------------------------------------------------------

def process(x, name, amount=1.0):
    """x: float32 mono a 24 kHz. amount 0-1: quanto effetto mescolare alla voce originale."""
    name = preset(name)
    amount = max(0.0, min(1.0, float(amount)))
    if name == "naturale" or amount <= 0 or not len(x):
        return x
    x = np.asarray(x, dtype=np.float32)
    if name == "computer":
        y = _filter(_filter(x, "highpass", 300), "lowpass", 4000)
        y = _reverb(y, 0.6, 0.18)
    elif name == "robotico":
        y = _ring(x, 50.0, 0.6)
        y = _bitcrush(y, 8, 2)
    elif name == "ia":
        y = _chorus(x)
        y = _reverb(y, 0.4, 0.12)
        y = _compress(y, -20.0, 3.0)
    elif name == "radio":
        y = _filter(_filter(x, "highpass", 500), "lowpass", 2800)
        y = np.tanh(3.0 * y) / np.tanh(3.0)
        y = np.concatenate([y, _squelch(len(y))])
    else:  # casco
        y = _filter(x, "lowpass", 2800)
        y = _reverb(y, 0.15, 0.25)
    n = max(len(x), len(y))
    dry = np.zeros(n, dtype=np.float32)
    dry[:len(x)] = x
    wet = np.zeros(n, dtype=np.float32)
    wet[:len(y)] = y
    # stesso volume percepito: il ramo con effetto viene riportato al livello RMS dell'originale
    rms_x = float(np.sqrt(np.mean(x ** 2))) + 1e-9
    rms_y = float(np.sqrt(np.mean(y ** 2))) + 1e-9
    out = (1 - amount) * dry + amount * wet * (rms_x / rms_y)
    peak = float(np.max(np.abs(out))) if len(out) else 0
    return (out / peak * 0.97 if peak > 0.97 else out).astype(np.float32)


# --- File -----------------------------------------------------------------------------------

def decode_mp3(path):
    """mp3 → float32 mono 24 kHz con PyAV."""
    import av
    chunks = []
    with av.open(path) as c:
        res = av.AudioResampler(format="s16", layout="mono", rate=RATE)
        for frame in c.decode(audio=0):
            for f in res.resample(frame):
                chunks.append(f.to_ndarray().reshape(-1))
        for f in res.resample(None):
            chunks.append(f.to_ndarray().reshape(-1))
    pcm = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.int16)
    return pcm.astype(np.float32) / 32768.0


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(buf.getvalue())
    os.replace(tmp, path)


def render(mp3_path, name, amount):
    """Percorso del wav con l'effetto (in cache accanto all'mp3), oppure l'mp3 se l'effetto è "naturale"."""
    name = preset(name)
    amt = int(round(max(0.0, min(1.0, float(amount))) * 100))
    if name == "naturale" or amt == 0 or not available():
        return mp3_path
    out = f"{os.path.splitext(mp3_path)[0]}.{name}{amt}.wav"
    if os.path.exists(out) and os.path.getsize(out) > 44:
        return out
    write_wav(out, process(decode_mp3(mp3_path), name, amt / 100.0))
    return out
