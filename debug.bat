@echo off
cd /d "%~dp0"
title DEX Labs - DEBUG (shows real errors)
echo ============================================
echo   Running server.js directly so you can see
echo   any error messages on screen (not hidden).
echo ============================================
echo.

set "DEXPORT=3002"
if exist "data\config.json" (
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "try { (Get-Content 'data\config.json' -Raw | ConvertFrom-Json).port } catch { 3002 }"`) do set "DEXPORT=%%p"
)
if "%DEXPORT%"=="" set "DEXPORT=3002"

echo Making sure port %DEXPORT% is free (stopping any stuck previous instance)...
call clear-port.bat
echo.
echo Press Ctrl+C to stop.
echo.
node server.js
echo.
echo ============================================
echo Server stopped or crashed - see any red text above.
echo ============================================
pause
