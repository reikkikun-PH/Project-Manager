@echo off
setlocal
cd /d "%~dp0"
echo ===================================================
echo  AI Scanner - Portable Setup (offline-ready)
echo  This will vendor all dependencies into .\libs
echo  So you can copy the folder anywhere.
echo ===================================================
echo.

REM Pick python
set PYTHON_CMD=
if exist "%~dp0python\python.exe" set PYTHON_CMD=%~dp0python\python.exe
if "%PYTHON_CMD%"=="" if exist "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe" set PYTHON_CMD=%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe
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

echo [INFO] Using: %PYTHON_CMD%
"%PYTHON_CMD%" --version
if %ERRORLEVEL% neq 0 (
  echo [ERROR] No python found. Install Python 3.11 64-bit from python.org
  pause & exit /b 1
)

REM Check if libs already present (offline copy)
if exist "%~dp0libs\cv2\__init__.py" (
  echo [OK] .\libs already exists - testing...
  "%PYTHON_CMD%" -c "import sys; sys.path.insert(0,'libs'); import cv2, numpy; print('[OK]', cv2.__version__, numpy.__version__)"
  if %ERRORLEVEL% equ 0 (
    echo [OK] Portable libs working - no install needed.
    goto :check_models
  )
)

echo [INFO] Installing to .\libs from requirements.txt ...
if not exist requirements.txt (
  echo [ERROR] requirements.txt missing
  pause & exit /b 1
)
REM Clean old partial libs
if exist libs rmdir /s /q libs 2>nul
mkdir libs 2>nul
"%PYTHON_CMD%" -m pip install --target libs -r requirements.txt --no-user
if %ERRORLEVEL% neq 0 (
  echo [ERROR] pip install failed - check internet
  pause & exit /b 1
)
echo [OK] Installed to .\libs
"%PYTHON_CMD%" -c "import sys; sys.path.insert(0,'libs'); import cv2, numpy, requests; print('[OK] cv2',cv2.__version__,'numpy',numpy.__version__)"

:check_models
echo.
if not exist "models\face_detection_yunet_2023mar.onnx" echo [WARN] Missing models/face_detection_yunet_2023mar.onnx
if not exist "models\face_recognition_sface_2021dec.onnx" echo [WARN] Missing models/face_recognition_sface_2021dec.onnx
if exist "models\face_detection_yunet_2023mar.onnx" if exist "models\face_recognition_sface_2021dec.onnx" echo [OK] Models present

if not exist cloudflared.exe echo [WARN] cloudflared.exe missing - host.bat Cloudflare tunnel won't work

echo.
echo ===================================================
echo  Setup done! Folder is now portable.
echo  Copy the ENTIRE folder (including libs\) to USB/other PC.
echo  Then just double-click runner.bat (local) or host.bat (Cloudflare public)
echo  No pip install needed on the other PC (Python 3.11 still required).
echo  For fully standalone (no Python install), add python embed:
echo    1) Download python-3.11.x-embed-amd64.zip from python.org
echo    2) Extract to .\python\  (so .\python\python.exe exists)
echo    3) bats will auto-use .\python\python.exe
echo ===================================================
pause
