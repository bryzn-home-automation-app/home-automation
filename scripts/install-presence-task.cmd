@echo off
:: One-time NUC setup for Who's home: run scripts\presence-scan.ps1 every minute as
:: SYSTEM (hidden, no logon needed; SYSTEM can clear the neighbor cache). Run from an
:: elevated prompt or an admin SSH session. Re-running replaces the task.
::   Remove: schtasks /delete /tn HomePresenceScan /f
setlocal
set SCRIPT=%~dp0presence-scan.ps1
schtasks /create /tn HomePresenceScan /ru SYSTEM /sc minute /mo 1 /rl HIGHEST /f ^
  /tr "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%SCRIPT%\""
if errorlevel 1 exit /b 1
schtasks /run /tn HomePresenceScan
