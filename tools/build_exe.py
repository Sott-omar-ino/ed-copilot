"""Compila Voidwatch ED in un unico eseguibile portatile: "Voidwatch ED.exe" nella radice del progetto.

Uso:  python tools\\build_exe.py
Richiede: pip install -r requirements.txt pyinstaller
I file temporanei della compilazione vanno nella cartella TEMP di Windows e vengono cancellati alla fine.
"""

import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = "Voidwatch ED"


def main():
    work = tempfile.mkdtemp(prefix="voidwatch_build_")
    sep = os.pathsep
    data = [("web", "web"), ("defaults", "defaults"), ("assets", "assets"), (os.path.join("data", "catalog.json"), "data")]
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--windowed",
           "--name", NAME, "--icon", os.path.join(ROOT, "assets", "app_icon.ico"),
           "--distpath", os.path.join(work, "dist"), "--workpath", os.path.join(work, "build"), "--specpath", work,
           "--hidden-import", "qrcode.image.pil", "--collect-data", "faster_whisper", "--collect-binaries", "ctranslate2",
           # Push-to-talk globale: sounddevice è importato solo quando serve, la DLL di PortAudio la raccoglie l'hook di PyInstaller.
           "--hidden-import", "sounddevice",
           # Tutti i moduli dell'app, anche quelli importati solo dentro una funzione (regioni, regole bio, effetti voce).
           "--collect-submodules", "app",
           "--exclude-module", "tkinter", "--exclude-module", "playwright"]
    for src, dst in data:
        cmd += ["--add-data", f"{os.path.join(ROOT, src)}{sep}{dst}"]
    cmd.append(os.path.join(ROOT, "run.py"))

    print("Compilazione in corso (qualche minuto)...")
    result = subprocess.run(cmd, cwd=ROOT)
    built = os.path.join(work, "dist", NAME + ".exe")
    if result.returncode != 0 or not os.path.exists(built):
        print("Compilazione non riuscita.")
        sys.exit(1)
    target = os.path.join(ROOT, NAME + ".exe")
    try:
        shutil.copy2(built, target)
    except PermissionError:
        # L'app è aperta: l'exe non si può sovrascrivere ma si può rinominare.
        # La nuova versione cancella il ".old" al primo avvio.
        old = target + ".old"
        if os.path.exists(old):
            os.remove(old)
        os.replace(target, old)
        shutil.copy2(built, target)
    shutil.rmtree(work, ignore_errors=True)
    print(f"Fatto: {target} ({os.path.getsize(target) / 1_048_576:.0f} MB)")


if __name__ == "__main__":
    main()
