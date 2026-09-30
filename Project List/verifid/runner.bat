@echo off
setlocal
cd /d "%~dp0"
set PORT=8100

echo ===================================================
echo  VerifID - Backend Runner (python)
echo  Local : http://localhost:%PORT%
echo ===================================================
echo.

REM Find working python (stub-safe: rejects the WindowsApps shim)
set PYTHON_CMD=
if exist "%~dp0python\python.exe" set PYTHON_CMD=%~dp0python\python.exe
if "%PYTHON_CMD%"=="" if exist "%~dp0venv\Scripts\python.exe" set PYTHON_CMD=%~dp0venv\Scripts\python.exe
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
  pause & exit /b 1
)
echo [OK] Python: %PYTHON_CMD%

REM Install dependencies when listed
if exist requirements.txt (
  echo [INFO] Installing Python dependencies from requirements.txt ...
  "%PYTHON_CMD%" -m pip install -r requirements.txt
  if %ERRORLEVEL% neq 0 echo [WARN] pip install reported issues - continuing anyway
)

echo [INFO] Starting backend (python server.py)...
echo [INFO] Keep this window open. Press Ctrl+C to stop.
start "" "http://localhost:%PORT%/"
"%PYTHON_CMD%" server.py
echo.
echo [INFO] Backend stopped.
pause
