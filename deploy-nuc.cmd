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

echo [4/4] Checking services... >> "%LOG%"
docker compose ps >> "%LOG%" 2>&1

:: Wait for backend to start, then show fresh logs
echo Waiting 20s for backend to start...
timeout /t 20 /nobreak >nul

echo.
echo ========================================
echo   Recent backend logs (last 20 lines)
echo ========================================
echo.
docker logs homeplatform-backend --tail 20

echo.
echo DEPLOY SUCCESSFUL >> "%LOG%"
echo Completed: %date% %time% >> "%LOG%"

exit /b 0
