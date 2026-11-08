"""Filtro rumori per i comandi vocali: toglie clic di tastiera, pulsanti della cloche e rumori brevi prima di Whisper.

Stessa logica in tutti i percorsi di cattura: microfono dell'app (audio inviato dal browser), push-to-talk globale
(ptt.py, sounddevice) e microfono del telefono. Il browser applica la stessa regola anche dal vivo
(voice-engine.js, NOISE_FILTER), così l'indicatore di livello mostra cosa viene tagliato.

Come funziona (frame da 10 ms):
1. Soglia = rumore di fondo + margine. Il rumore di fondo è quello misurato con "Calibra rumore di fondo" oppure,
   se manca, il 5° percentile dei frame della registrazione stessa (i frame più silenziosi). Il margine cresce con
   il cursore "Filtro rumori".
2. I frame sopra soglia formano degli "eventi". Un evento più corto di min_ms è un rumore impulsivo (un clic di un
   tasto dura pochi millisecondi: è un impulso che decade in fretta) e viene scartato.
3. Sopra il 20% serve anche voce "sonora": la voce ha armoniche (spettro a righe, piattezza spettrale bassa e pochi
   attraversamenti dello zero), un clic è a banda larga (spettro piatto, simile al rumore bianco).
   Piattezza spettrale = media geometrica / media aritmetica dello spettro di potenza (Gray e Markel, "A spectral-
   flatness measure for studying the autocorrelation method of linear prediction of speech analysis", IEEE Trans.
   ASSP 22(3), 1974). Energia + attraversamenti dello zero per trovare inizio e fine del parlato: Rabiner e Sambur,
   "An algorithm for determining the endpoints of isolated utterances", Bell System Technical Journal 54(2), 1975.
4. Fuori dagli eventi tenuti l'audio diventa silenzio; a Whisper arriva solo il parlato. Poi Whisper applica anche il
   suo VAD (Silero), con parametri regolati dallo stesso cursore (vad_parameters).

Serve numpy (arriva con faster-whisper). Senza numpy le funzioni restituiscono None e l'app usa il vecchio controllo.
"""

try:
    import numpy as np
except Exception:  # pragma: no cover - senza numpy il filtro si disattiva
    np = None

FRAME_MS = 10
MERGE_GAP_MS = 50          # due pezzi separati da meno di 50 ms sono lo stesso evento (chiusure delle consonanti)
NEAR_MS = 300              # una sillaba corta ma sonora vicina al parlato tenuto fa parte della stessa frase
PAD_MS = 150               # attorno al parlato tenuto si lascia un po' di audio (consonanti deboli)
MIN_KEEP_MS = 150          # meno di così in totale: nessun comando detto
ABS_MIN_THRESHOLD_DB = -60.0
VOICED_FLATNESS = 0.30     # sotto: spettro "a righe" (voce sonora)
VOICED_ZCR = 0.25          # attraversamenti dello zero per campione: la voce sonora sta molto sotto


def available():
    return np is not None


def params(strength):
    """Tutte le grandezze derivate dal cursore 0-100 (le stesse usate dal browser: tienile allineate)."""
    s = max(0.0, min(100.0, float(strength if strength is not None else 50))) / 100.0
    return {
        "strength": round(s * 100),
        "margin_db": 3.0 + 15.0 * s,               # 0% → 3 dB sopra il fondo, 50% → 10.5 dB, 100% → 18 dB
        "min_ms": int(round(40 + 110 * s)),        # 0% → 40 ms, 50% → 95 ms, 100% → 150 ms
        "voiced_check": s >= 0.2,
        "voiced_ratio": 0.08 + 0.22 * s,           # quota minima di frame "sonori" in un evento
    }


def vad_parameters(strength):
    """Parametri per il VAD Silero di faster-whisper (VadOptions: threshold 0.5, min_speech_duration_ms 0,
    min_silence_duration_ms 2000, speech_pad_ms 400 sono i valori predefiniti della libreria)."""
    p = params(strength)
    s = p["strength"] / 100.0
    return {"threshold": round(0.35 + 0.3 * s, 2), "min_speech_duration_ms": p["min_ms"],
            "min_silence_duration_ms": 500, "speech_pad_ms": 200}


def to_float(pcm16):
    """bytes int16 → float32 in [-1, 1]."""
    return np.frombuffer(pcm16[:len(pcm16) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0


def _frames(x, rate):
    n = max(1, int(rate * FRAME_MS / 1000))
    count = len(x) // n
    return x[:count * n].reshape(count, n) if count else np.zeros((0, n), dtype=np.float32), n


def frame_db(x, rate=16000):
    f, _ = _frames(x, rate)
    if not len(f):
        return np.zeros(0)
    rms = np.sqrt(np.mean(f.astype(np.float64) ** 2, axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-6))


def noise_floor_db(x, rate=16000):
    """Rumore di fondo di una registrazione di solo ambiente (calibrazione): mediana dei frame, in dBFS."""
    db = frame_db(x, rate)
    return float(np.median(db)) if len(db) else None


def _features(f):
    """Piattezza spettrale (banda 150-5000 Hz a 16 kHz) e tasso di attraversamento dello zero per frame."""
    win = np.hanning(f.shape[1])
    spec = np.abs(np.fft.rfft(f * win, n=256, axis=1)) ** 2 + 1e-12
    band = spec[:, 2:81]  # bin da 62.5 Hz: circa 125-5000 Hz
    flat = np.exp(np.mean(np.log(band), axis=1)) / np.mean(band, axis=1)
    zcr = np.mean(np.abs(np.diff(np.signbit(f), axis=1)), axis=1)
    return flat, zcr


def _runs(mask):
    """Inizio/fine (esclusa) delle sequenze di True."""
    if not mask.any():
        return []
    d = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))


def analyze(x, rate=16000, strength=50, floor_db=None):
    """Analizza l'audio (float32 mono). Restituisce un dict con l'audio filtrato ("audio"), gli eventi trovati e
    se c'è del parlato ("speech"). Gli eventi scartati hanno il motivo ("breve" o "non vocale")."""
    p = params(strength)
    x = np.asarray(x, dtype=np.float32)
    f, n = _frames(x, rate)
    out = {"speech": False, "events": [], "kept_ms": 0, "params": p, "audio": np.zeros_like(x)}
    if len(f) < 3:
        return out
    db = frame_db(x, rate)
    clip_floor = float(np.percentile(db, 5))
    loud = float(np.percentile(db, 95))
    floor = clip_floor if floor_db is None else min(float(floor_db), clip_floor + 6)
    if loud > -30:  # registrazione quasi tutta parlata (niente pause): la soglia resta 25 dB sotto la voce
        floor = min(floor, loud - 25)
    thr = max(floor + p["margin_db"], ABS_MIN_THRESHOLD_DB)
    out.update(floor_db=round(floor, 1), threshold_db=round(thr, 1))
    active = db >= thr
    # unisci i buchi brevi (chiusure delle consonanti) dentro lo stesso evento
    gap = MERGE_GAP_MS // FRAME_MS
    for a, b in _runs(~active):
        if a > 0 and b < len(active) and b - a <= gap:
            active[a:b] = True
    flat, zcr = _features(f)
    voiced = (flat < VOICED_FLATNESS) & (zcr < VOICED_ZCR) & (db >= thr)
    keep = np.zeros(len(f), dtype=bool)
    events = []
    for a, b in _runs(active):
        ms = (b - a) * FRAME_MS
        ratio = float(voiced[a:b].mean())
        ev = {"start_ms": int(a * FRAME_MS), "ms": int(ms), "voiced": round(ratio, 2), "_ab": (a, b)}
        is_voiced = not p["voiced_check"] or ratio >= p["voiced_ratio"]
        ev["_voiced"] = ratio >= p["voiced_ratio"]
        if ms < p["min_ms"]:
            ev["drop"] = "breve"
        elif not is_voiced:
            ev["drop"] = "non vocale"
        else:
            keep[a:b] = True
        events.append(ev)
    # sillabe corte ma sonore accanto al parlato tenuto: stessa frase (un clic non è sonoro e resta fuori)
    near = NEAR_MS // FRAME_MS
    changed = True
    while changed:
        changed = False
        for ev in events:
            a, b = ev["_ab"]
            if "drop" in ev and ev["_voiced"] and keep[max(0, a - near):min(len(keep), b + near)].any():
                keep[a:b] = True
                ev.pop("drop")
                changed = True
    out["events"] = [{k: v for k, v in ev.items() if not k.startswith("_")} for ev in events]
    out["kept_ms"] = int(keep.sum() * FRAME_MS)
    if out["kept_ms"] < MIN_KEEP_MS:
        return out
    pad = PAD_MS // FRAME_MS
    padded = keep.copy()
    for a, b in _runs(keep):
        padded[max(0, a - pad):min(len(keep), b + pad)] = True
    gain = np.repeat(padded.astype(np.float32), n)
    fade = np.hanning(2 * n)[:n].astype(np.float32)  # 10 ms di dissolvenza: niente "clic" creati dal taglio
    k = np.convolve(gain, fade / fade.sum(), mode="same")
    audio = np.zeros_like(x)
    audio[:len(k)] = x[:len(k)] * np.clip(k, 0, 1)
    out.update(speech=True, audio=audio)
    return out
