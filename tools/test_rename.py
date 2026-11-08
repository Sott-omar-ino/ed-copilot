"""Prove del cambio di nome ED Copilot -> Voidwatch ED: migrazione della cartella dati, variabili d'ambiente,
riconoscimento degli asset delle release (nome nuovo e vecchio) e del vecchio repository degli aggiornamenti.

Uso:  python tools\\test_rename.py   (lavora solo in cartelle temporanee)
"""
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
_TMP = tempfile.mkdtemp(prefix="voidwatch_rename_test_")
os.environ["VOIDWATCH_DATA"] = os.path.join(_TMP, "data")  # app.paths crea le sue cartelle qui, non nei dati veri

from app import paths, updater  # noqa: E402

FAILS = []
PASSED = [0]


def check(cond, msg):
    if cond:
        PASSED[0] += 1
    else:
        FAILS.append(msg)
        print("FALLITO:", msg)


def test_env():
    saved = {k: os.environ.pop(k, None) for k in ("VOIDWATCH_PORT", "ED_COPILOT_PORT")}
    try:
        check(paths.env("PORT") is None and paths.env("PORT", "8765") == "8765", "env: nessuna variabile")
        os.environ["ED_COPILOT_PORT"] = "9100"
        check(paths.env("PORT") == "9100", "env: vale ancora il vecchio ED_COPILOT_PORT")
        os.environ["VOIDWATCH_PORT"] = "9200"
        check(paths.env("PORT") == "9200", "env: VOIDWATCH_PORT ha la precedenza")
    finally:
        for k, v in saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v
    check(paths.DATA_DIR == os.path.join(_TMP, "data"), "env: VOIDWATCH_DATA sceglie la cartella dati")


def test_migration():
    base = os.path.join(_TMP, "app")
    new, old = os.path.join(base, paths.DATA_FOLDER), os.path.join(base, paths.LEGACY_DATA_FOLDER)
    check(paths.DATA_FOLDER == "Voidwatch ED - dati" and paths.LEGACY_DATA_FOLDER == "ED Copilot - dati", "nomi cartelle")

    # 1. Solo la vecchia cartella: viene rinominata, con tutto il contenuto.
    os.makedirs(os.path.join(old, "cache"))
    with open(os.path.join(old, "todo.json"), "w", encoding="utf-8") as f:
        f.write("[1]")
    paths.NOTES.clear()
    used = paths.migrate_folder(new, old)
    check(used == new and os.path.isdir(new) and not os.path.exists(old), "migrazione: vecchia cartella rinominata")
    with open(os.path.join(new, "todo.json"), encoding="utf-8") as f:
        check(f.read() == "[1]", "migrazione: file conservati")
    check(os.path.isdir(os.path.join(new, "cache")), "migrazione: sottocartelle conservate")
    check(any("rinominata" in n for n in paths.NOTES), "migrazione: annotata per il registro")

    # 2. Già migrata: non si tocca niente.
    paths.NOTES.clear()
    check(paths.migrate_folder(new, old) == new and not paths.NOTES, "già migrata: nulla da fare")

    # 3. Esistono entrambe (per esempio è stata riaperta una vecchia versione): vince la nuova, la vecchia resta.
    os.makedirs(old)
    check(paths.migrate_folder(new, old) == new and os.path.isdir(old), "entrambe: si usa la nuova, la vecchia resta")
    shutil.rmtree(old)

    # 4. Nessuna delle due (prima installazione): la nuova, creata poi da _writable.
    fresh_new, fresh_old = os.path.join(_TMP, "fresh", paths.DATA_FOLDER), os.path.join(_TMP, "fresh", paths.LEGACY_DATA_FOLDER)
    check(paths.migrate_folder(fresh_new, fresh_old) == fresh_new and not os.path.exists(fresh_old), "prima installazione")

    # 5. Vecchia cartella bloccata (file aperto, per esempio dalla vecchia versione ancora in chiusura): si usa la vecchia.
    lock_base = os.path.join(_TMP, "locked")
    lnew, lold = os.path.join(lock_base, paths.DATA_FOLDER), os.path.join(lock_base, paths.LEGACY_DATA_FOLDER)
    os.makedirs(lold)
    real_replace = os.replace

    def failing_replace(a, b):
        raise PermissionError(32, "Il file è utilizzato da un altro processo")
    os.replace = failing_replace
    try:
        paths.NOTES.clear()
        used = paths.migrate_folder(lnew, lold)
    finally:
        os.replace = real_replace
    check(used == lold and os.path.isdir(lold) and not os.path.exists(lnew), "bloccata: si continua con la vecchia")
    check(any("vecchia cartella" in n for n in paths.NOTES), "bloccata: annotata per il registro")

    # 6. Anche con un file davvero aperto (Windows non rinomina una cartella con file aperti senza FILE_SHARE_DELETE).
    if os.name == "nt":
        log = open(os.path.join(lold, "registro.log"), "a", encoding="utf-8")
        try:
            used = paths.migrate_folder(lnew, lold)
        finally:
            log.close()
        check(used == lold and not os.path.exists(lnew), "file aperto: si continua con la vecchia")
        check(paths.migrate_folder(lnew, lold) == lnew and not os.path.exists(lold), "file chiuso: al giro dopo rinomina")


def test_assets():
    def a(name):
        return {"name": name, "browser_download_url": "https://example.invalid/" + name}

    def pick(names):
        exe, sha = updater.pick_assets([a(n) for n in names])
        return (exe or {}).get("name"), (sha or {}).get("name")

    check(pick(["Voidwatch.ED.exe", "Voidwatch.ED.exe.sha256", "notes.txt"]) == ("Voidwatch.ED.exe", "Voidwatch.ED.exe.sha256"),
          "asset: nome nuovo (spazi diventati punti su GitHub)")
    check(pick(["Voidwatch ED.exe", "Voidwatch ED.exe.sha256"]) == ("Voidwatch ED.exe", "Voidwatch ED.exe.sha256"),
          "asset: nome nuovo con lo spazio")
    check(pick(["ED.Copilot.exe", "ED.Copilot.exe.sha256"]) == ("ED.Copilot.exe", "ED.Copilot.exe.sha256"),
          "asset: vecchio nome con i punti")
    check(pick(["ED Copilot.exe"]) == ("ED Copilot.exe", None), "asset: vecchio nome senza .sha256 (impronta da GitHub)")
    check(pick(["ED.Copilot.exe", "ED.Copilot.exe.sha256", "Voidwatch.ED.exe", "Voidwatch.ED.exe.sha256"])
          == ("Voidwatch.ED.exe", "Voidwatch.ED.exe.sha256"), "asset: con entrambi vince il nome nuovo, con la sua impronta")
    check(pick(["Voidwatch.ED.exe", "ED.Copilot.exe.sha256"]) == ("Voidwatch.ED.exe", None),
          "asset: l'impronta di un altro file non vale")
    check(pick(["Voidwatch.ED.zip", "EDCopilot.exe", "voidwatch-ed.exe", "Voidwatch.ED.exe.sha256"]) == (None, None),
          "asset: nomi diversi ignorati")
    check(updater.pick_assets(None) == (None, None) and updater.pick_assets([None, "x"]) == (None, None), "asset: lista vuota o rovinata")


def test_repo():
    check(updater.DEFAULT_REPO == "Sott-omar-ino/voidwatch-ed", "repo: predefinito")
    for saved in (None, "", "  ", "Sott-omar-ino/ed-copilot", "sott-omar-ino/ED-Copilot", " Sott-omar-ino/ed-copilot "):
        check(updater.normalize_repo(saved) == updater.DEFAULT_REPO, f"repo: {saved!r} -> predefinito")
    check(updater.normalize_repo("qualcuno/fork-ed-copilot") == "qualcuno/fork-ed-copilot", "repo: un fork resta com'è")
    check(updater.normalize_repo("Sott-omar-ino/voidwatch-ed") == "Sott-omar-ino/voidwatch-ed", "repo: nuovo nome")


if __name__ == "__main__":
    try:
        test_env()
        test_migration()
        test_assets()
        test_repo()
    finally:
        shutil.rmtree(_TMP, ignore_errors=True)
    print(f"{PASSED[0]} controlli superati, {len(FAILS)} falliti")
    sys.exit(1 if FAILS else 0)
