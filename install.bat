@echo off
setlocal
cd /d "%~dp0"
title DEX Labs - Install

echo ============================================
echo   DEX Labs - Installer
echo ============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js was not found on this computer.
  echo Please install Node.js LTS from https://nodejs.org first,
  echo then run install.bat again.
  echo.
  pause
  exit /b 1
)
echo [OK] Node.js found.

echo.
echo Installing dependencies, this happens once and may take a minute...
call npm install --production --no-audit --no-fund
if %errorlevel% neq 0 (
  echo [ERROR] npm install failed. Check your internet connection and try again.
  pause
  exit /b 1
)
echo [OK] Dependencies installed.

echo.
echo Setting up the port configuration (first-time only)...
if not exist "data" mkdir data
if not exist "data\config.json" (
  powershell -NoProfile -Command "@{port=3002} | ConvertTo-Json | Set-Content -Path 'data\config.json' -Encoding UTF8"
)
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "(Get-Content 'data\config.json' -Raw | ConvertFrom-Json).port"`) do set "DEXPORT=%%p"
if "%DEXPORT%"=="" set "DEXPORT=3002"
echo [OK] Using port %DEXPORT% (change anytime later via the tray icon's Settings menu).

echo.
echo Opening firewall for port %DEXPORT% so phones/PCs on your WiFi can connect...
netsh advfirewall firewall show rule name="LessonTracker3002" >nul 2>nul
if %errorlevel% neq 0 (
  netsh advfirewall firewall add rule name="LessonTracker3002" dir=in action=allow protocol=TCP localport=%DEXPORT% >nul
  echo [OK] Firewall rule added.
) else (
  echo [OK] Firewall rule already exists.
)

echo.
echo Generating the tray icon...
powershell -NoProfile -ExecutionPolicy Bypass -File "generate-icon.ps1" >nul 2>nul

echo.
echo Creating Desktop and Start Menu shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -File "create-shortcuts.ps1"
if %errorlevel% equ 0 (
  echo [OK] Shortcuts created - click either one anytime to open DEX Labs.
) else (
  echo [WARN] Could not create shortcuts - you can still use start.bat, or the auto-start below.
)

echo.
echo Setting up auto-start when you log into Windows...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
  echo Set WshShell = CreateObject("WScript.Shell"^)
  echo WshShell.CurrentDirectory = "%~dp0"
  echo WshShell.Run "powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File ""%~dp0tray.ps1""", 0, False
) > "%STARTUP%\LessonTracker.vbs"
echo [OK] Will auto-start silently (with a system tray icon) next time you log in.

echo.
echo Making sure port %DEXPORT% is free (stopping any stuck previous instance)...
call clear-port.bat
echo Starting the server now...
wscript.exe //nologo "%STARTUP%\LessonTracker.vbs"
timeout /t 2 >nul

echo.
echo ============================================
echo   All done!
echo ============================================
echo On this PC, open:      http://localhost:%DEXPORT%
echo From phones on WiFi:
ipconfig | findstr /i "IPv4"
echo   (use one of the addresses above with :%DEXPORT%)
echo.
echo Look for the DEX Labs icon in your system tray (near the clock) -
echo click it for Console / Update / Settings / Exit.
echo A "DEX Labs" shortcut is also on your Desktop and in your Start Menu.
echo.
echo The server now also starts automatically whenever you log in.
echo Use stop.bat to stop it, or uninstall.bat to remove auto-start.
echo.
echo Also starting: the Landing Page - a front page listing DEX Labs and
echo anything else running on this PC, reachable from any device on your
echo WiFi at just the IP address above with NO port needed. If Windows
echo asks for permission in a moment, that's for this (opening the
echo firewall for it) - click Yes. Turn it off any time from the tray
echo icon's right-click menu if you don't want it.
echo.
pause
