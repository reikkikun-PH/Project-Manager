@echo off
setlocal
cd /d "%~dp0"
REM Thin launcher: host.py picks a working python and runs backend + tunnel
REM together in this one terminal. Ctrl+C stops everything.
REM
REM Second instance example:
REM   set PM_INSTANCE=lab & set PM_SLOT=1 & set PORT=8010 & host.bat
py -3 host.py
if errorlevel 1 python host.py
pause