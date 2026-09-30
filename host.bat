@echo off
setlocal
cd /d "%~dp0"
set PORT=8000

echo ===================================================
echo  Server Project Manager - single terminal host
echo  Backend + tunnel run here. Ctrl+C stops everything.
echo ===================================================
echo.

REM Find working python - PORTABLE: .\python -> .\venv -> hermes -> system (stub-safe)
set PYTHON_CMD=
if exist "%~dp0python\python.exe" set PYTHON_CMD=%~dp0python\python.exe
if "%PYTHON_CMD%"=="" if exist "%~dp0venv\Scripts\python.exe" set PYTHON_CMD=%~dp0venv\Scripts\python.exe
if "%PYTHON_CMD%"=="" if exist "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe" (
    "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe" -c "import sys" >nul 2>&1
    if not errorlevel 1 set PYTHON_CMD=%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe
)
if "%PYTHON_CMD%"=="" (
  where python >nul 2>&1
  if not errorlevel 1 (
    python --version >nul 2>&1
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
if "%PYTHON_CMD%"=="" (
  echo [ERROR] No working python found. Install Python from python.org
  pause
  exit /b 1
)
echo [OK] Python: %PYTHON_CMD%
if exist "%~dp0libs\cv2\__init__.py" echo [OK] Portable libs: .\libs ^(copy folder anywhere^)

if not exist "%~dp0host.py" (
    echo [ERROR] host.py not found in "%~dp0"
    pause
    exit /b 1
)

REM Single terminal: host.py runs backend + tunnel as children here.
"%PYTHON_CMD%" "%~dp0host.py"

echo.
echo [INFO] host.py exited. Re-run host.bat to share again.
pause
