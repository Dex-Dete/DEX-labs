@echo off
setlocal
cd /d "%~dp0"
title DEX Labs - Auto-Start Repair

rem v1.3.0. (Re)creates the current-user Startup-folder shortcut that
rem silently launches DEX Labs (via run-hidden.vbs -> tray.ps1) when you
rem log into Windows. Needs NO elevation - the Startup folder and
rem shortcut files here are entirely user-writable.
rem
rem Root cause this fixes: before v1.3.0, this entry was only ever
rem CREATED by install.bat, and nothing ever re-checked or repaired it
rem afterwards - including apply-update.ps1, which is what actually runs
rem every time you update through the tray's "Check for Updates" menu or
rem update.bat. So if that Startup entry ever went missing (a common
rem cause: antivirus/Defender flagging a hidden-launch script sitting in
rem the Startup folder as suspicious, since that's a known malware
rem pattern too, even though this one is legitimate), updating did
rem nothing to bring it back - only manually re-running install.bat from
rem scratch would. This script is that repair step, made safe to run on
rem its own, and now also called automatically at the end of every
rem update (see apply-update.ps1) so this self-heals going forward.
rem
rem Also consolidates onto the single existing run-hidden.vbs launcher
rem (already used by start.bat and the Desktop/Start Menu shortcuts from
rem create-shortcuts.ps1) instead of the separate inline copy of the
rem same "launch tray.ps1 hidden" logic that install.bat used to write
rem directly into the Startup folder - one launcher, one place it's
rem defined, so a future fix to it can't silently miss a second copy.
rem
rem Deliberately idempotent - running this five times in a row leaves
rem you in exactly the same state as running it once. Safe to double-
rem click by hand anytime auto-start seems to have stopped working,
rem without needing to reinstall anything.

echo ============================================
echo   DEX Labs - Auto-Start Repair
echo ============================================
echo.

if not exist "run-hidden.vbs" (
  echo [ERROR] run-hidden.vbs is missing from this folder - can't set up auto-start.
  echo This usually means the install is incomplete. Try running install.bat.
  pause
  exit /b 1
)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\DEX Labs.lnk"

rem Clean up the OLD pre-v1.3.0 inline-VBS Startup entry if present, so
rem there's only ever one auto-start mechanism active at a time (two
rem separate things both trying to launch the server on login would
rem race each other pointlessly).
if exist "%STARTUP%\LessonTracker.vbs" (
  del /f /q "%STARTUP%\LessonTracker.vbs" >nul 2>nul
  echo [OK] Removed the old pre-v1.3.0 auto-start entry (replacing it below).
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%~dp0run-hidden.vbs'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'DEX Labs (auto-start)'; $s.Save()"

if exist "%SHORTCUT%" (
  echo [OK] Auto-start is set up - DEX Labs will start silently next time you log in.
) else (
  echo [WARN] Could not create the auto-start shortcut. You can still start DEX Labs manually with start.bat or the Desktop shortcut.
)

echo.
if "%1"=="/silent" (
  rem Called automatically from apply-update.ps1 at the end of every
  rem update - no pause, so it doesn't block/interrupt that flow.
  exit /b 0
)
pause
