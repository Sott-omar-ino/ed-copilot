# Prova automatica della finestra nativa: avvia l'app, controlla che la finestra compaia, la chiude e verifica che il processo termini.
# Uso: powershell -File tools\test_window.ps1 [percorso dell'exe]   (senza argomenti prova i sorgenti con python run.py)
param([string]$Exe = "")

$env:VOIDWATCH_DATA = "$env:TEMPoidwatch_test_window"
if ($Exe) { $p = Start-Process -FilePath $Exe -PassThru }
else { $p = Start-Process pythonw -ArgumentList "run.py" -WorkingDirectory (Split-Path $PSScriptRoot) -PassThru }

$win = $null
for ($i = 0; $i -lt 40 -and -not $win; $i++) {
    Start-Sleep -Milliseconds 500
    $win = Get-Process | Where-Object { $_.MainWindowTitle -eq "Voidwatch ED" } | Select-Object -First 1
}
if (-not $win) { "ERRORE: finestra non comparsa"; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; exit 1 }
"Finestra comparsa (processo $($win.Id), $($win.ProcessName))"
try { $ping = Invoke-WebRequest http://127.0.0.1:8765/api/ping -UseBasicParsing -TimeoutSec 5; "Server: $($ping.Content)" } catch { "Server non raggiungibile: $_" }
Start-Sleep -Seconds 4
$null = $win.CloseMainWindow()
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) { "Finestra chiusa: il processo e terminato correttamente."; break }
}
if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) { "ATTENZIONE: il processo e ancora attivo dopo la chiusura"; Stop-Process -Id $p.Id -Force }
Remove-Item $env:VOIDWATCH_DATA -Recurse -Force -ErrorAction SilentlyContinue
