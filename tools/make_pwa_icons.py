"""Crea le icone dell'app per il telefono (companion installato come app) dall'icona dell'app, assets/app_icon.ico.

    python tools/make_pwa_icons.py

Scrive in web/icons/:
- icon-192.png, icon-512.png: icona normale (bordo arrotondato, angoli trasparenti), come assets/app_icon.ico;
- maskable-192.png, maskable-512.png: icona "maskable" a tutto campo. Il sistema la ritaglia (cerchio, goccia...):
  il disegno sta nella zona sicura, un cerchio centrale con raggio pari al 40% della larghezza
  (web.dev/articles/maskable-icon: "must be within a circular area in the center of the icon with a radius equal to
  40% of the icon width");
- apple-touch-icon.png (180x180): iPhone/iPad, senza trasparenza (iOS arrotonda da solo gli angoli).

Il disegno (bordo, doppio rombo, punto centrale) è quello dell'icona .ico, ridisegnato in grande con le stesse proporzioni
e gli stessi colori (letti dall'icona) perché la .ico arriva al massimo a 256 px: ingrandirla la sfocherebbe.
Proporzioni misurate sul livello 256x256: bordo 10 px, raggio degli angoli 40, rombo esterno dal centro al vertice
98 (spessore 11 in orizzontale), rombo pieno 62, punto centrale raggio 18.
"""

import os
import sys
from collections import Counter

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICO = os.path.join(ROOT, "assets", "app_icon.ico")
OUT = os.path.join(ROOT, "web", "icons")
SS = 4  # sovracampionamento: disegno 4 volte più grande e poi riduco, per bordi lisci


def colors():
    """I due colori dell'icona: arancio (tratti) e quasi-nero (fondo), i più frequenti tra i pixel opachi."""
    with Image.open(ICO) as im:
        im.size = max(im.ico.sizes())
        raw = im.convert("RGBA").tobytes()
    px = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 4) if raw[i + 3] == 255]
    common = [c for c, _ in Counter(px).most_common(2)]
    dark, orange = sorted(common, key=sum)
    return orange, dark


def diamond(draw, cx, cy, r, fill):
    draw.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=fill)


def emblem(draw, size, scale, orange, dark):
    """Doppio rombo + punto. scale = distanza centro-vertice del rombo esterno in frazione del lato."""
    c = size / 2
    k = scale * size / 98  # unità: un pixel dell'icona da 256 con il rombo esterno a 98
    diamond(draw, c, c, 98 * k, orange)
    diamond(draw, c, c, 87 * k, dark)
    diamond(draw, c, c, 62 * k, orange)
    draw.ellipse([c - 18 * k, c - 18 * k, c + 18 * k, c + 18 * k], fill=dark)


def regular(px, orange, dark):
    n = px * SS
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = n / 256
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=40 * u, fill=orange)
    d.rounded_rectangle([10 * u, 10 * u, n - 1 - 10 * u, n - 1 - 10 * u], radius=30 * u, fill=dark)
    emblem(d, n, 98 / 256, orange, dark)
    return im.resize((px, px), Image.LANCZOS)


def full_bleed(px, orange, dark, scale):
    n = px * SS
    im = Image.new("RGB", (n, n), dark)
    emblem(ImageDraw.Draw(im), n, scale, orange, dark)
    return im.resize((px, px), Image.LANCZOS)


def main():
    orange, dark = colors()
    os.makedirs(OUT, exist_ok=True)
    for px in (192, 512):
        regular(px, orange, dark).save(os.path.join(OUT, f"icon-{px}.png"), optimize=True)
        # Vertice del rombo a 0,36 del lato dal centro: dentro il cerchio sicuro (raggio 0,40).
        full_bleed(px, orange, dark, 0.36).save(os.path.join(OUT, f"maskable-{px}.png"), optimize=True)
    full_bleed(180, orange, dark, 0.38).save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
    print("Icone scritte in", OUT, "- colori", orange, dark)


if __name__ == "__main__":
    sys.exit(main())
