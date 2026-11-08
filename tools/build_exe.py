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


def _version_file(work):
    """Informazioni di versione dell'exe (Proprietà → Dettagli in Windows): un exe senza nome del prodotto, versione
    e descrizione viene considerato più sospetto da alcuni antivirus."""
    import re
    ver = re.search(r'VERSION = "([^"]+)"', open(os.path.join(ROOT, "app", "__init__.py"), encoding="utf-8").read()).group(1)
    parts = [int(x) for x in re.findall(r"\d+", ver)][:4]
    parts += [0] * (4 - len(parts))
    t = tuple(parts)
    text = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={t}, prodvers={t}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'Voidwatch ED (open source)'),
      StringStruct('FileDescription', 'Voidwatch ED - Elite Dangerous companion'),
      StringStruct('FileVersion', '{ver}'),
      StringStruct('InternalName', 'Voidwatch ED'),
      StringStruct('LegalCopyright', 'GNU GPL v2 or later - github.com/Sott-omar-ino/voidwatch-ed'),
      StringStruct('OriginalFilename', 'Voidwatch ED.exe'),
      StringStruct('ProductName', 'Voidwatch ED'),
      StringStruct('ProductVersion', '{ver}')])]),
    VarFileInfo([VarStruct('Translation', [0x0409, 1200])])
  ]
)
"""
    path = os.path.join(work, "version_info.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def main():
    work = tempfile.mkdtemp(prefix="voidwatch_build_")
    sep = os.pathsep
    data = [("web", "web"), ("defaults", "defaults"), ("assets", "assets"), (os.path.join("data", "catalog.json"), "data")]
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--windowed",
           "--name", NAME, "--icon", os.path.join(ROOT, "assets", "app_icon.ico"),
           "--version-file", _version_file(work),
           # Niente compressione UPX: gli exe compressi vengono segnalati più spesso dagli antivirus.
           "--noupx",
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
