"""Crea le versioni statiche di Saira (pesi usati dall'app) con lo zero barrato, per distinguere 0 e O.

Saira è distribuito con licenza SIL OFL 1.1 senza Reserved Font Name: la modifica è permessa (web/fonts/OFL.txt).
Uso: python tools/make_slashed_zero.py  (richiede fonttools e brotli)
"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "web", "fonts", "Saira-latin.woff2")
WEIGHTS = (500, 600, 700, 800)


def slash(font, name):
    gs = font.getGlyphSet()
    rec = DecomposingRecordingPen(gs)  # zero.tf può essere un composito che rimanda a zero
    gs[name].draw(rec)
    bp = BoundsPen(gs)
    rec.replay(bp)
    x0, y0, x1, y1 = bp.bounds
    w, h = x1 - x0, y1 - y0
    # verso del contorno esterno (il primo): la barra va disegnata nello stesso verso per riempire anche il foro
    area = AreaPen()
    for op, args in rec.value:
        getattr(area, op)(*args)
        if op in ("closePath", "endPath"):
            break
    t = w * 0.16  # spessore della barra
    ax, ay, bx, by = x0 + w * 0.18, y0 + h * 0.10, x1 - w * 0.18, y1 - h * 0.10
    pts = [(ax - t / 2, ay), (ax + t / 2, ay), (bx + t / 2, by), (bx - t / 2, by)]
    if area.value < 0:
        pts.reverse()
    pen = TTGlyphPen(None)
    rec.replay(pen)
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()
    glyf = font["glyf"]
    glyf[name] = pen.glyph()
    glyf[name].recalcBounds(glyf)


def main():
    for wght in WEIGHTS:
        f = TTFont(SRC)
        f = instancer.instantiateVariableFont(f, {"wght": wght})
        for name in ("zero.tf", "zero"):  # prima il composito, che altrimenti erediterebbe la barra
            if name in f["glyf"].keys():
                slash(f, name)
        f.flavor = "woff2"
        out = os.path.join(ROOT, "web", "fonts", f"Saira-{wght}-latin-slashedzero.woff2")
        f.save(out)
        print(out, os.path.getsize(out))


if __name__ == "__main__":
    main()
