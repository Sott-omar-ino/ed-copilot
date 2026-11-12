"""Punto di avvio di Voidwatch ED (dai sorgenti: python run.py)."""

import os
import sys

# Dopo un aggiornamento automatico l'exe nuovo è avviato dal vecchio (app/updater.py) e ne eredita le variabili _PYI_*
# del bootloader di PyInstaller: si crede il processo figlio del vecchio exe e usa la sua cartella temporanea, che il
# vecchio cancella uscendo (moduli mancanti: voce, finestra, HTTPS). Fino alla 7.7 l'updater non ripuliva l'ambiente:
# in quel caso si riparte una volta con PYINSTALLER_RESET_ENVIRONMENT=1, che fa ignorare quelle variabili (PyInstaller
# 6.9+, documentazione "Common Issues and Pitfalls" > "Independent subprocess"). Solo os e sys: niente altri import
# finché non si è ripartiti.
if getattr(sys, "frozen", False) and "--wait-pid" in sys.argv and not os.environ.get("VOIDWATCH_CLEAN_ENV"):
    os.environ["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    os.environ["VOIDWATCH_CLEAN_ENV"] = "1"
    os.startfile(sys.executable, arguments=f"--wait-pid {os.getpid()}")
    os._exit(0)

from app.main import main

if __name__ == "__main__":
    main()
