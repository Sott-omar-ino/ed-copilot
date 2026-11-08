"""Prove del filtro rumori (app/noise_filter.py) e degli effetti voce (app/voice_fx.py) con audio sintetico.

Nessun audio viene registrato o riprodotto. Uso: python tools/test_audio_filters.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import numpy as np  # noqa: E402

from app import noise_filter as nf  # noqa: E402
from app import voice_fx  # noqa: E402

R = 16000


def speech(sec=1.2, amp=0.3, f0=130.0):
    """Segnale simile a una voce sonora: armoniche di una fondamentale che varia, a sillabe (~4 al secondo)."""
    t = np.arange(int(R * sec)) / R
    ph = 2 * np.pi * np.cumsum(f0 + 30 * np.sin(2 * np.pi * 1.3 * t)) / R
    s = sum(np.sin(k * ph) / k * (1.5 if 3 <= k <= 6 else 1) for k in range(1, 25))
    env = np.clip(np.sin(np.pi * t * 4.2) ** 2 * 1.2, 0, 1) ** 0.5
    return (amp * s / np.max(np.abs(s)) * env).astype(np.float32)


def click(amp=0.5, seed=0):
    """Clic di un tasto: impulso a banda larga che decade in pochi ms, più una piccola risonanza meccanica."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(R * 0.02)) / R
    c = rng.normal(0, 1, len(t)) * np.exp(-t / 0.002) + 0.6 * np.sin(2 * np.pi * 3200 * t) * np.exp(-t / 0.006)
    return (amp * c / np.max(np.abs(c))).astype(np.float32)


def place(total, items, noise=0.001, seed=1):
    x = np.random.default_rng(seed).normal(0, noise, int(R * total)).astype(np.float32)
    for at, sig in items:
        i = int(at * R)
        x[i:i + len(sig)] += sig[:len(x) - i]
    return x


class NoiseFilterTest(unittest.TestCase):
    def test_single_click_is_not_speech(self):
        for st in (30, 50, 80, 100):
            self.assertFalse(nf.analyze(place(1, [(0.3, click())]), R, st)["speech"], st)

    def test_typing_is_not_speech(self):
        typing = place(2, [(0.1 + i * 0.12, click(0.3 + 0.02 * i, seed=i)) for i in range(15)])
        fast = place(2, [(0.1 + i * 0.06, click(0.4, seed=i)) for i in range(28)])
        for st in (30, 50, 80, 100):
            self.assertFalse(nf.analyze(typing, R, st)["speech"], st)
            self.assertFalse(nf.analyze(fast, R, st)["speech"], st)

    def test_speech_is_kept(self):
        for st in (0, 30, 50, 80, 100):
            r = nf.analyze(place(2, [(0.3, speech())]), R, st)
            self.assertTrue(r["speech"], st)
            self.assertGreater(r["kept_ms"], 1000, st)

    def test_quiet_and_continuous_speech(self):
        for st in (30, 50, 80):
            self.assertTrue(nf.analyze(place(2, [(0.3, speech(amp=0.03))]), R, st)["speech"], st)
            self.assertTrue(nf.analyze(speech(1.0), R, st)["speech"], st)  # nessuna pausa nella registrazione

    def test_ptt_button_clicks_are_removed_but_speech_stays(self):
        x = place(2, [(0.05, click()), (0.4, speech(1.0)), (1.8, click())])
        r = nf.analyze(x, R, 50)
        self.assertTrue(r["speech"])
        out = r["audio"]
        self.assertLess(np.max(np.abs(out[int(0.04 * R):int(0.08 * R)])), 1e-3)   # clic iniziale azzerato
        self.assertLess(np.max(np.abs(out[int(1.79 * R):int(1.83 * R)])), 1e-3)   # clic finale azzerato
        mid = slice(int(0.6 * R), int(1.2 * R))
        self.assertTrue(np.allclose(out[mid], x[mid]))                             # voce intatta
        self.assertEqual(sum(e.get("drop") == "breve" for e in r["events"]), 2)

    def test_fan_noise_floor_and_calibration(self):
        rng = np.random.default_rng(5)
        fan = rng.normal(0, 0.01, 2 * R).astype(np.float32)  # circa -40 dBFS
        floor = nf.noise_floor_db(fan, R)
        self.assertAlmostEqual(floor, -40, delta=1.5)
        x = fan.copy()
        x[int(0.5 * R):int(0.5 * R) + int(1.2 * R)] += speech()
        x[int(1.9 * R):int(1.9 * R) + 320] += click()
        r = nf.analyze(x, R, 50, floor_db=floor)
        self.assertTrue(r["speech"])
        self.assertAlmostEqual(r["threshold_db"], floor + nf.params(50)["margin_db"], delta=1.5)
        self.assertFalse(nf.analyze(fan, R, 50, floor_db=floor)["speech"])  # solo ventola

    def test_params_monotonic(self):
        prev = None
        for st in range(0, 101, 10):
            p, v = nf.params(st), nf.vad_parameters(st)
            if prev:
                self.assertGreaterEqual(p["margin_db"], prev[0]["margin_db"])
                self.assertGreaterEqual(p["min_ms"], prev[0]["min_ms"])
                self.assertGreaterEqual(v["threshold"], prev[1]["threshold"])
            prev = (p, v)
        self.assertEqual(nf.params(100)["min_ms"], 150)
        self.assertTrue(0 < nf.vad_parameters(50)["threshold"] < 1)


class VoiceFxTest(unittest.TestCase):
    def setUp(self):
        t = np.arange(int(voice_fx.RATE * 1.0)) / voice_fx.RATE
        self.x = (0.3 * np.sin(2 * np.pi * 220 * t) + 0.1 * np.sin(2 * np.pi * 3000 * t)).astype(np.float32)

    def test_all_presets_finite_and_bounded(self):
        for name in voice_fx.PRESETS:
            y = voice_fx.process(self.x, name, 1.0)
            self.assertTrue(np.all(np.isfinite(y)), name)
            self.assertLessEqual(float(np.max(np.abs(y))), 0.98, name)
            self.assertGreaterEqual(len(y), len(self.x), name)

    def test_naturale_and_zero_amount_are_identity(self):
        self.assertIs(voice_fx.process(self.x, "naturale", 1.0), self.x)
        self.assertIs(voice_fx.process(self.x, "radio", 0.0), self.x)

    def test_radio_is_band_limited(self):
        def band(sig, lo, hi):
            f = np.fft.rfftfreq(len(sig), 1 / voice_fx.RATE)
            s = np.abs(np.fft.rfft(sig)) ** 2
            return s[(f >= lo) & (f < hi)].sum() / s.sum()
        y = voice_fx.process(self.x, "radio", 1.0)[:len(self.x)]
        self.assertLess(band(y, 0, 300), band(self.x, 0, 300))

    def test_lowpass_attenuates_high(self):
        y = voice_fx._filter(self.x, "lowpass", 1000)
        f = np.fft.rfftfreq(len(y), 1 / voice_fx.RATE)
        hi = (f > 2900) & (f < 3100)
        self.assertLess(np.abs(np.fft.rfft(y))[hi].max(), 0.2 * np.abs(np.fft.rfft(self.x))[hi].max())

    def test_unknown_preset(self):
        self.assertEqual(voice_fx.preset("jarvis"), "naturale")


if __name__ == "__main__":
    unittest.main(verbosity=1)
