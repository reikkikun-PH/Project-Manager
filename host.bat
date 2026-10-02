@echo off
setlocal
cd /d "%~dp0"
REM Thin launcher: host.py picks a working python and runs backend + tunnel
REM together in this one terminal. Ctrl+C stops everything.
py -3 host.py
if errorlevel 1 python host.py
pause