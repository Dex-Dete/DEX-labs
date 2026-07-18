@echo off
setlocal
cd /d "%~dp0"
title DEX Labs - Update

echo ============================================
echo   DEX Labs - Update
echo ============================================
echo.

set "ZIPPATH=%~1"
if "%ZIPPATH%"=="" (
  echo Pick the update .zip file...
  for /f "usebackq delims=" %%f in (`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'DEX Labs update (*.zip)|*.zip'; $f.Title = 'Select a DEX Labs update file'; if ($f.ShowDialog() -eq 'OK') { $f.FileName }"`) do set "ZIPPATH=%%f"
)
if "%ZIPPATH%"=="" (
  echo No file selected. Cancelled.
  pause
  exit /b 1
)
echo Update file: %ZIPPATH%
echo.

for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content 'package.json' -Raw | ConvertFrom-Json).version"`) do set "CURRENTVER=%%v"
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead('%ZIPPATH%'); $e = $z.Entries | Where-Object { $_.FullName -eq 'package.json' } | Select-Object -First 1; if ($e) { $r = New-Object System.IO.StreamReader($e.Open()); $t = $r.ReadToEnd(); $r.Close(); $z.Dispose(); (ConvertFrom-Json $t).version } else { $z.Dispose(); '' }"`) do set "NEWVER=%%v"

if "%NEWVER%"=="" (
  echo [ERROR] That doesn't look like a DEX Labs update - no package.json found in it.
  pause
  exit /b 1
)

echo Currently installed: v%CURRENTVER%
echo Selected update:     v%NEWVER%
echo.

powershell -NoProfile -Command "if (-not ([version]'%NEWVER%' -gt [version]'%CURRENTVER%')) { exit 1 } else { exit 0 }"
if %errorlevel% neq 0 (
  echo [CANCELLED] The selected update is not newer than what's currently installed.
  pause
  exit /b 1
)

echo This will back up your lessons/tutes/AirDrop files automatically,
echo then update the app and restart the server.
choice /M "Continue with the update"
if %errorlevel% neq 1 (
  echo Cancelled.
  pause
  exit /b 1
)

echo.
echo Stopping the server if it's running...
call clear-port.bat

echo Applying update...
powershell -NoProfile -ExecutionPolicy Bypass -File "apply-update.ps1" -ZipPath "%ZIPPATH%"
set UPDATE_RESULT=%errorlevel%

echo.
echo Restarting DEX Labs...
call start.bat

echo.
if "%UPDATE_RESULT%"=="0" (
  echo ============================================
  echo   Update complete - now running v%NEWVER%
  echo ============================================
) else (
  echo ============================================
  echo   Update finished with warnings - check the
  echo   output above. Your previous data is safely
  echo   backed up in the "backups" folder.
  echo ============================================
)
pause
