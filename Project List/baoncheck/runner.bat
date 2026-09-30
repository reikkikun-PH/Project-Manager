@echo off
setlocal
cd /d "%~dp0"
set PORT=8100

echo ===================================================
echo  BaonCheck - Localhost Runner (static server)
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

REM Bump port if busy (up to +10)
set TRIES=0
:findport
netstat -ano | findstr ":%PORT% " | findstr LISTENING >nul 2>&1
if %ERRORLEVEL% neq 0 goto :serve
set /a PORT+=1
set /a TRIES+=1
if %TRIES% geq 10 (
  echo [ERROR] No free port near 8100.
  pause & exit /b 1
)
goto :findport

:serve
echo [OK] Serving this folder at http://localhost:%PORT%
echo [INFO] Keep this window open. Press Ctrl+C to stop.
start "" "http://localhost:%PORT%/"
"%PYTHON_CMD%" -m http.server %PORT%
echo.
echo [INFO] Server stopped.
pause
