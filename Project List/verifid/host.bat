@echo off
setlocal
cd /d "%~dp0"
set PORT=8000
set LOCAL_URL=http://127.0.0.1:%PORT%

echo ===================================================
echo  AI Scanner — Host with Cloudflare Tunnel (cloudflared)
echo  Local : %LOCAL_URL%
echo ===================================================
echo.

REM Check cloudflared
if not exist "%~dp0cloudflared.exe" (
    echo [ERROR] cloudflared.exe not found in "%~dp0"
    echo Download from https://developers.cloudflare.com/cloudflare-one/connections/connect/networks/downloads/
    pause
    exit /b 1
)
echo [OK] cloudflared.exe found

REM Find python with cv2 - PORTABLE: .\python -> .\libs -> system
set PYTHON_CMD=
if exist "%~dp0python\python.exe" set PYTHON_CMD=%~dp0python\python.exe
if "%PYTHON_CMD%"=="" if exist "%~dp0venv\Scripts\python.exe" set PYTHON_CMD=%~dp0venv\Scripts\python.exe
if "%PYTHON_CMD%"=="" if exist "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe" (
    "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe" -c "import cv2" >nul 2>&1
    if not errorlevel 1 set PYTHON_CMD=%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe
)
if "%PYTHON_CMD%"=="" (
    where python >nul 2>&1
    if not errorlevel 1 (
        python -c "import sys; sys.path.insert(0,'libs'); import cv2" >nul 2>&1
        if not errorlevel 1 set PYTHON_CMD=python
    )
)
if "%PYTHON_CMD%"=="" (
  where py >nul 2>&1
  if not errorlevel 1 (
    py --version >nul 2>&1
    if not errorlevel 1 set PYTHON_CMD=py
  )
)
echo [OK] Python: %PYTHON_CMD%
if exist "%~dp0libs\cv2\__init__.py" echo [OK] Portable libs: .\libs ^(copy folder anywhere^)

REM Clean stale cloudflared (avoid duplicate 530 errors)
echo [INFO] Cleaning old tunnels...
taskkill /F /IM cloudflared.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM Start backend if not already listening
netstat -ano | findstr ":%PORT% " | findstr LISTENING >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Backend already running on %LOCAL_URL%
) else (
    echo [INFO] Starting server.py in new window "AI Scanner Backend - LOGS"...
    start "AI Scanner Backend - LOGS - Do Not Close" cmd /k ""%PYTHON_CMD%" server.py"
    timeout /t 4 /nobreak >nul
)

REM Verify backend
powershell -NoProfile -Command "try{Invoke-WebRequest -Uri '%LOCAL_URL%/' -UseBasicParsing -TimeoutSec 5|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Backend not responding at %LOCAL_URL% - check server.py logs
    echo [HINT] Close all "AI Scanner Backend" windows and re-run host.bat
    pause
    exit /b 1
)
echo [OK] Backend OK at %LOCAL_URL%
echo.
echo ===================================================
echo  Starting Cloudflare Quick Tunnel (PUBLIC - works on any phone)
echo  URL will appear below as https://xxxx.trycloudflare.com
echo  Keep BOTH windows open. Ctrl+C to stop tunnel.
echo  Local: %LOCAL_URL%  -  Test: %LOCAL_URL%/
echo ===================================================
echo.

REM Run tunnel in foreground so URL stays visible (logs to console)
"%~dp0cloudflared.exe" tunnel --url %LOCAL_URL%

echo.
echo [INFO] Tunnel stopped. Backend still running in "AI Scanner Backend" window.
echo [INFO] To stop backend, close that window or Ctrl+C there.
pause
