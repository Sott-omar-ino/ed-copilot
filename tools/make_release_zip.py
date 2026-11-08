"""Crea "ED Copilot.zip" da condividere: solo l'eseguibile e il LEGGIMI, senza i tuoi dati personali.

Uso:  python tools\\make_release_zip.py   (dopo python tools\\build_exe.py)
"""

import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ["ED Copilot.exe", "LEGGIMI.md"]


def main():
    missing = [f for f in FILES if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit(f"Mancano: {', '.join(missing)}. Compila prima con tools\\build_exe.py")
    out = os.path.join(ROOT, "ED Copilot.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in FILES:
            zf.write(os.path.join(ROOT, f), f)
    print(f"Fatto: {out} ({os.path.getsize(out) / 1_048_576:.0f} MB)")


if __name__ == "__main__":
    main()
