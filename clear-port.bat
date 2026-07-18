@echo off
rem Shared helper: kills anything on the configured port (and any
rem tray.ps1 instance). Called by install.bat/start.bat/debug.bat before
rem launching, so a leftover process from a previous crash/session never
rem causes "address already in use" on the next start.
rem Reads the port from data\config.json (set via the tray's Settings
rem menu) - falls back to 3002 if that file doesn't exist yet.
set "DEXPORT=3002"
if exist "data\config.json" (
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "try { (Get-Content 'data\config.json' -Raw | ConvertFrom-Json).port } catch { 3002 }"`) do set "DEXPORT=%%p"
)
if "%DEXPORT%"=="" set "DEXPORT=3002"

for /f "tokens=5" %%p in ('netstat -ano ^| findstr :%DEXPORT% ^| findstr LISTENING') do (
  taskkill /F /PID %%p >nul 2>nul
)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*tray.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

rem v1.1.4: also free the Landing Page's port (80 by default - see
rem landing-page\server.js's readOwnPort()). tray.ps1 now manages the
rem Landing Page as a child process alongside the main server (no more
rem separate install-landing.bat), so "stop DEX Labs" needs to stop that
rem too, same as it already does for the main port above.
rem PID 4 ("System") is special-cased and left alone - that means
rem Windows' own http.sys has the port reserved (usually IIS/"World Wide
rem Web Publishing Service"), not a stray copy of this app, and isn't a
rem real process you can/should taskkill.
set "LPPORT=80"
if exist "landing-page\data\landing-config.json" (
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "try { (Get-Content 'landing-page\data\landing-config.json' -Raw | ConvertFrom-Json).port } catch { 80 }"`) do set "LPPORT=%%p"
) else if exist "data\config.json" (
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "try { $v = (Get-Content 'data\config.json' -Raw | ConvertFrom-Json).landingPagePort; if ($v) { $v } else { 80 } } catch { 80 }"`) do set "LPPORT=%%p"
)
if "%LPPORT%"=="" set "LPPORT=80"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :%LPPORT% ^| findstr LISTENING') do (
  if not "%%p"=="4" taskkill /F /PID %%p >nul 2>nul
)

