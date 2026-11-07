@echo off
:: One-time NUC setup for Admin -> NUC Health. Run from an elevated prompt or an admin SSH
:: session; re-running replaces it.
::   HomeHostMetrics   scripts\host-metrics.ps1 every minute as SYSTEM (hidden; SYSTEM can
::                     read the SSD's health counters). A run is stopped after 2 minutes,
::                     and one still going when the next is due makes that one skip.
:: Remove:
::   schtasks /delete /tn HomeHostMetrics /f
setlocal
set AGENT=%~dp0host-metrics.ps1

schtasks /create /tn HomeHostMetrics /ru SYSTEM /sc minute /mo 1 /rl HIGHEST /f ^
  /tr "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%AGENT%\""
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -Command "Set-ScheduledTask -TaskName HomeHostMetrics -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable) | Out-Null"
if errorlevel 1 exit /b 1
schtasks /run /tn HomeHostMetrics
