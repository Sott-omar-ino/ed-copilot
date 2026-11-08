@echo off
rem Avvia Voidwatch ED dai sorgenti (serve Python 3.10+). Per l'uso normale basta "Voidwatch ED.exe".
title Voidwatch ED (sorgenti)
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python non e installato o non e nel PATH.
    echo Scaricalo da https://www.python.org/downloads/ e spunta "Add Python to PATH".
    pause
    exit /b 1
)

python -c "import webview, edge_tts" >nul 2>nul
if errorlevel 1 (
    echo Prima configurazione: installo le librerie necessarie...
    python -m pip install --quiet -r requirements.txt
)

start "" pythonw run.py
