@echo off
title DEX Labs - Uninstall
cd /d "%~dp0"

echo Stopping server and tray icon if running...
call clear-port.bat

echo Removing auto-start...
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LessonTracker.vbs" 2>nul

echo Removing Desktop and Start Menu shortcuts...
del "%USERPROFILE%\Desktop\DEX Labs.lnk" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\DEX Labs.lnk" 2>nul

echo Removing firewall rule...
netsh advfirewall firewall delete rule name="LessonTracker3002" >nul 2>nul

rem v1.1.4: the Landing Page (front page on port 80, integrated into the
rem tray - see tray.ps1's Start-DexLandingPage) gets its own firewall
rem rule the first time it runs; clean that up too. Safe no-op if it was
rem never created (Landing Page disabled, or never got elevation).
netsh advfirewall firewall delete rule name="DexLabsLandingPage80" >nul 2>nul

echo.
echo Uninstalled. Your lessons/files were NOT deleted -
echo they're still in the "data" and "uploads" folders in this app folder.
echo (Your saved Landing Page site list, if you used it, is still in
echo "landing-page\data" too.)
echo (Backups made by past updates are in the "backups" folder too.)
echo Delete this whole folder manually if you want to remove everything.
echo.
pause
