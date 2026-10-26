@echo off
:: One-time NUC setup for Who's home. Run from an elevated prompt or an admin SSH
:: session; re-running replaces everything.
::   HomePresenceScan      scripts\presence-scan.ps1 every minute as SYSTEM (hidden;
::                         SYSTEM can clear the neighbor cache).
::   HomePresenceIdentify  scripts\presence-identify.ps1 at boot as SYSTEM: the
::                         "Link this device" listener on TCP 8099.
::   Firewall rule         TCP 8099 inbound, local subnet only.
:: Remove:
::   schtasks /delete /tn HomePresenceScan /f
::   schtasks /end /tn HomePresenceIdentify & schtasks /delete /tn HomePresenceIdentify /f
::   netsh advfirewall firewall delete rule name="HomeOS Link this device"
setlocal
set SCAN=%~dp0presence-scan.ps1
set IDENTIFY=%~dp0presence-identify.ps1

schtasks /create /tn HomePresenceScan /ru SYSTEM /sc minute /mo 1 /rl HIGHEST /f ^
  /tr "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%SCAN%\""
if errorlevel 1 exit /b 1
schtasks /run /tn HomePresenceScan

schtasks /end /tn HomePresenceIdentify >nul 2>&1
schtasks /create /tn HomePresenceIdentify /ru SYSTEM /sc onstart /rl HIGHEST /f ^
  /tr "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%IDENTIFY%\""
if errorlevel 1 exit /b 1
:: Long-running: no 72-hour limit, and restart it if it ever exits.
powershell.exe -NoProfile -Command "Set-ScheduledTask -TaskName HomePresenceIdentify -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) | Out-Null"
schtasks /run /tn HomePresenceIdentify

netsh advfirewall firewall delete rule name="HomeOS Link this device" >nul 2>&1
netsh advfirewall firewall add rule name="HomeOS Link this device" dir=in action=allow ^
  protocol=TCP localport=8099 remoteip=localsubnet profile=any
