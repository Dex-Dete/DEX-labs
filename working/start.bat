@echo off
cd /d "%~dp0"
title DEX Labs - Start

set "DEXPORT=3002"
if exist "data\config.json" (
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "try { (Get-Content 'data\config.json' -Raw | ConvertFrom-Json).port } catch { 3002 }"`) do set "DEXPORT=%%p"
)
if "%DEXPORT%"=="" set "DEXPORT=3002"

echo Making sure port %DEXPORT% is free (stopping any stuck previous instance)...
call clear-port.bat

echo Starting DEX Labs (Lesson Tracker + AirDrop + Daily Schedule + Timers) in the background...
wscript.exe //nologo "%~dp0run-hidden.vbs"
timeout /t 2 >nul

echo.
echo Server started.
echo On this PC:        http://localhost:%DEXPORT%
echo From phones/WiFi:
ipconfig | findstr /i "IPv4"
echo.
pause
