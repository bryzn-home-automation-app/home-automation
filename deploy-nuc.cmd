@echo off
setlocal

cd /d %~dp0

set LOG=%~dp0deploy.log

echo ======================================== > "%LOG%"
echo   Home Automation Deploy >> "%LOG%"
echo   %date% %time% >> "%LOG%"
echo ======================================== >> "%LOG%"
echo. >> "%LOG%"

echo [1/4] Pulling latest... >> "%LOG%"
git pull origin master >> "%LOG%" 2>&1
if errorlevel 1 (
    echo DEPLOY FAILED: git pull >> "%LOG%"
    exit /b 1
)

echo [2/4] Rebuilding Docker images... >> "%LOG%"
for /f "tokens=*" %%i in ('git rev-parse --short HEAD') do set GIT_COMMIT=%%i
echo    commit: %GIT_COMMIT% >> "%LOG%"
docker compose build backend nginx >> "%LOG%" 2>&1
if errorlevel 1 (
    echo DEPLOY FAILED: docker build >> "%LOG%"
    exit /b 1
)

echo [3/4] Starting stack... >> "%LOG%"
docker compose up -d >> "%LOG%" 2>&1
if errorlevel 1 (
    echo DEPLOY FAILED: docker compose up >> "%LOG%"
    exit /b 1
)

echo [4/4] Checking services + showing fresh logs... >> "%LOG%"
docker compose ps >> "%LOG%" 2>&1

:: Wait for backend to be healthy, then show only new logs
echo Waiting for backend...
for /l %%i in (1,1,12) do (
    curl -s http://localhost/api/health 2>nul | findstr /c:"UP" >nul && goto :healthy
    timeout /t 5 /nobreak >nul
)
:healthy

echo.
echo ========================================
echo   Recent backend logs (last 20 lines)
echo ========================================
echo.
docker logs homeplatform-backend --tail 20

echo.
echo ========================================
echo   Deploy complete. Live log tail:
echo ========================================
echo.
docker logs homeplatform-backend --tail 0 -f

exit /b 0
