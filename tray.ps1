# DEX Labs tray app - the actual application now (this IS what gets
# launched by the Desktop/Start Menu shortcuts and auto-start).
#
# Architecture note (v0.2.2 stability rewrite): earlier versions showed/
# hid this script's OWN console window for the "Console" feature. That
# was the root cause of the "tray won't close / closes unexpectedly"
# problem: if you close a console window via its native [X] button
# (rather than our menu), Windows terminates the WHOLE process hosting
# it - which was this tray app itself, taking the server down with it,
# unpredictably. Fixed by never showing this process's own console at
# all. Instead, "Console" opens a completely separate, disposable
# PowerShell window that just tails logs.txt - closing THAT window has
# zero effect on the tray or the server, by construction, because it's
# a different process entirely.
#
# Built with PowerShell + built-in .NET (WinForms/Drawing), NOT an npm
# tray package - avoids adding another native/compiled dependency that
# could fail to install (see: the whole @distube/ytpl saga).

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName Microsoft.VisualBasic

# Force TLS 1.2 for outbound GitHub API/download calls (auto-update). Older
# Windows/PowerShell 5.1 defaults can negotiate TLS 1.0, which GitHub
# rejects outright - without this, every auto-update check fails with an
# opaque "could not connect" error that looks like a network problem but
# isn't.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

# ---------- auto-update source (GitHub Releases) ----------
# Update zips are expected as a .zip asset attached to the latest GitHub
# Release, with package.json at the zip root (same requirement as the
# manual update path).
$RepoOwner = "Dex-Dete"
$RepoName = "DEX-labs"
# How often the background auto-update check runs while idle. 5 minutes -
# frequent enough to pick up a new release quickly, infrequent enough to
# never be a meaningful load on GitHub's API or this PC.
$UpdateCheckIntervalMs = 5 * 60 * 1000

$AppRoot = $PSScriptRoot
Set-Location $AppRoot
$LogPath = Join-Path $AppRoot "logs.txt"

function Write-DexLog($msg) {
  try { Add-Content -Path $LogPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" -ErrorAction SilentlyContinue } catch {}
}

# Hide this process's own console immediately and permanently - see note
# above for why this is never shown again.
Add-Type -Name Win32Console -Namespace DexLabs -MemberDefinition '
  [DllImport("Kernel32.dll")]
  public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'
try {
  $consoleHandle = [DexLabs.Win32Console]::GetConsoleWindow()
  [DexLabs.Win32Console]::ShowWindow($consoleHandle, 0) | Out-Null # 0 = SW_HIDE
} catch {}

# Everything else is wrapped in one top-level try/catch so an unexpected
# error becomes a visible message + a logs.txt entry instead of the tray
# app just silently vanishing with no clue why.
try {

# ---------- config (port, auto-update toggle, etc.) ----------
function Get-DexConfig {
  $configPath = Join-Path $AppRoot "data\config.json"
  # v1.0.5: airdropMaxUsageGB/airdropSaveLocation/setupComplete added -
  # same file the Node server reads via lib/config-store.js, so either
  # side (tray Settings menu or the website's Settings page) can change
  # these and the other will see it immediately (no caching on either
  # end - both re-read data/config.json fresh every time).
  # v1.1.4: landingPageEnabled added - controls whether tray.ps1 starts
  # the Landing Page (port 80 front page, see Start-DexLandingPage)
  # alongside the main server. Defaults to true ("on unless the person
  # deliberately turns it off from the tray menu"), matching the
  # explicit ask that it "just runs" without a separate install step.
  $default = @{ port = 3002; autoUpdate = $true; airdropMaxUsageGB = 30; airdropSaveLocation = ""; setupComplete = $false; landingPageEnabled = $true }
  try {
    if (Test-Path $configPath) {
      $loaded = Get-Content $configPath -Raw | ConvertFrom-Json
      $port = if ($loaded.port) { [int]$loaded.port } else { $default.port }
      $autoUpdate = if ($null -ne $loaded.autoUpdate) { [bool]$loaded.autoUpdate } else { $default.autoUpdate }
      $airdropMaxUsageGB = if ($loaded.airdropMaxUsageGB) { [double]$loaded.airdropMaxUsageGB } else { $default.airdropMaxUsageGB }
      $airdropSaveLocation = if ($null -ne $loaded.airdropSaveLocation) { [string]$loaded.airdropSaveLocation } else { $default.airdropSaveLocation }
      $setupComplete = if ($null -ne $loaded.setupComplete) { [bool]$loaded.setupComplete } else { $default.setupComplete }
      # Existing v1.1.3 users' config.json predates this key entirely -
      # $loaded.landingPageEnabled will be $null for them, which the
      # `$null -ne` check below correctly treats as "use the default
      # (true)" rather than misreading absence as false.
      $landingPageEnabled = if ($null -ne $loaded.landingPageEnabled) { [bool]$loaded.landingPageEnabled } else { $default.landingPageEnabled }
      return @{ port = $port; autoUpdate = $autoUpdate; airdropMaxUsageGB = $airdropMaxUsageGB; airdropSaveLocation = $airdropSaveLocation; setupComplete = $setupComplete; landingPageEnabled = $landingPageEnabled }
    }
  } catch {}
  return $default
}
function Set-DexConfigPort([int]$NewPort) {
  $dataDir = Join-Path $AppRoot "data"
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
  $configPath = Join-Path $dataDir "config.json"
  $current = @{}
  try {
    if (Test-Path $configPath) { $current = Get-Content $configPath -Raw | ConvertFrom-Json }
  } catch {}
  $obj = @{}
  if ($current.PSObject -and $current.PSObject.Properties) {
    foreach ($p in $current.PSObject.Properties) { $obj[$p.Name] = $p.Value }
  }
  $obj.port = $NewPort
  ($obj | ConvertTo-Json) | Set-Content -Path $configPath -Encoding UTF8
}
function Set-DexConfigAutoUpdate([bool]$Enabled) {
  $dataDir = Join-Path $AppRoot "data"
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
  $configPath = Join-Path $dataDir "config.json"
  $current = @{}
  try {
    if (Test-Path $configPath) { $current = Get-Content $configPath -Raw | ConvertFrom-Json }
  } catch {}
  $obj = @{}
  if ($current.PSObject -and $current.PSObject.Properties) {
    foreach ($p in $current.PSObject.Properties) { $obj[$p.Name] = $p.Value }
  }
  $obj.autoUpdate = $Enabled
  ($obj | ConvertTo-Json) | Set-Content -Path $configPath -Encoding UTF8
}
# v1.1.4: same merge-in pattern as the toggle above, for the Landing
# Page's own on/off switch (tray menu checkbox - see $menuLandingToggle).
function Set-DexConfigLandingPage([bool]$Enabled) {
  $dataDir = Join-Path $AppRoot "data"
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
  $configPath = Join-Path $dataDir "config.json"
  $current = @{}
  try {
    if (Test-Path $configPath) { $current = Get-Content $configPath -Raw | ConvertFrom-Json }
  } catch {}
  $obj = @{}
  if ($current.PSObject -and $current.PSObject.Properties) {
    foreach ($p in $current.PSObject.Properties) { $obj[$p.Name] = $p.Value }
  }
  $obj.landingPageEnabled = $Enabled
  ($obj | ConvertTo-Json) | Set-Content -Path $configPath -Encoding UTF8
}
# v1.0.5: lets the tray's Settings menu set the same AirDrop
# max-usage/save-location/setupComplete fields the website's Settings
# page writes via PUT /api/settings - same data/config.json file, same
# "merge in, don't clobber other keys" pattern as the two functions above.
function Set-DexConfigAirdrop([double]$MaxUsageGB, [string]$SaveLocation) {
  $dataDir = Join-Path $AppRoot "data"
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
  $configPath = Join-Path $dataDir "config.json"
  $current = @{}
  try {
    if (Test-Path $configPath) { $current = Get-Content $configPath -Raw | ConvertFrom-Json }
  } catch {}
  $obj = @{}
  if ($current.PSObject -and $current.PSObject.Properties) {
    foreach ($p in $current.PSObject.Properties) { $obj[$p.Name] = $p.Value }
  }
  $obj.airdropMaxUsageGB = $MaxUsageGB
  $obj.airdropSaveLocation = $SaveLocation
  $obj.setupComplete = $true
  ($obj | ConvertTo-Json) | Set-Content -Path $configPath -Encoding UTF8
}

# ---------- version ----------
function Get-CurrentVersion {
  try {
    $pkg = Get-Content (Join-Path $AppRoot "package.json") -Raw | ConvertFrom-Json
    return $pkg.version
  } catch {
    return "0.0.0"
  }
}
$CurrentVersion = Get-CurrentVersion
$DisplayLabel = "DEX Labs v$CurrentVersion"

# ---------- tray icon (generated once, cached to disk) ----------
$IconPath = Join-Path $AppRoot "tray-icon.ico"
. (Join-Path $AppRoot "generate-icon.ps1")
if (-not (Test-Path $IconPath)) {
  try { New-DexTrayIcon -Path $IconPath } catch { Write-DexLog "Could not generate tray icon: $_" }
}

# ---------- kill anything already running (port + name-scoped) ----------
# This is the "kill node" behavior explicitly wanted for BOTH startup and
# exit: never leaves a stale/duplicate server process behind. Scoped to
# (a) whatever port is currently configured, and (b) node processes whose
# command line mentions server.js - deliberately NOT a blanket
# `taskkill /IM node.exe`, which would also kill unrelated Node
# applications the user might have running for other things.
function Clear-DexNodeProcess {
  $cfg = Get-DexConfig
  $port = $cfg.port
  try {
    $lines = netstat -ano | Select-String ":$port " | Select-String "LISTENING"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
      Stop-Process -Id $parts[-1] -Force -ErrorAction SilentlyContinue
    }
  } catch {}
  try {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*server.js*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
  Start-Sleep -Milliseconds 300 # give the OS a moment to actually release the port
}

function Clear-DuplicateTrayInstances {
  try {
    $myPid = $PID
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*tray.ps1*' -and $_.ProcessId -ne $myPid } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}

# ---------- server child process management ----------
$script:ServerProcess = $null
$script:OutputSubs = @()
$script:CurrentPort = (Get-DexConfig).port

function Start-DexServer {
  Clear-DexNodeProcess
  $cfg = Get-DexConfig
  $script:CurrentPort = $cfg.port

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = "server.js"
  $psi.WorkingDirectory = $AppRoot
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables["PORT"] = "$($cfg.port)"

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $proc.EnableRaisingEvents = $true

  $handler = {
    if ($null -ne $Event.SourceEventArgs.Data) {
      $logPath = $Event.MessageData
      try { Add-Content -Path $logPath -Value $Event.SourceEventArgs.Data -ErrorAction SilentlyContinue } catch {}
    }
  }
  $script:OutputSubs += Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action $handler -MessageData $LogPath
  $script:OutputSubs += Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action $handler -MessageData $LogPath

  $proc.Start() | Out-Null
  $proc.BeginOutputReadLine()
  $proc.BeginErrorReadLine()
  $script:ServerProcess = $proc
  Write-DexLog "=== DEX Labs server started (PID $($proc.Id), port $($cfg.port)) ==="
  if ($notifyIcon) { $notifyIcon.Text = "$DisplayLabel (port $($cfg.port))" }
}

function Stop-DexServer {
  foreach ($sub in $script:OutputSubs) {
    try { Unregister-Event -SourceIdentifier $sub.Name -ErrorAction SilentlyContinue } catch {}
  }
  $script:OutputSubs = @()
  if ($script:ServerProcess -and -not $script:ServerProcess.HasExited) {
    try { $script:ServerProcess.Kill() } catch {}
  }
  Clear-DexNodeProcess
  $script:ServerProcess = $null
  Write-DexLog "=== DEX Labs server stopped ==="
}

# ---------- v1.1.4: Landing Page child process management ----------
# The Landing Page (landing-page/server.js - the "type just your IP, no
# port" front page listing websites on this PC, port 80 by default) was
# a fully separate program in v1.1.3, with its own install-landing.bat
# the user had to run by hand. As of v1.1.4 it's managed by the tray
# exactly like the main Node server: started alongside it, restarted by
# the same watchdog if it dies, stopped alongside it on Exit - no
# separate install step. Kept as a genuinely separate CHILD PROCESS on
# its own port, though (not merged into the main server.js) - see the
# big comment at the top of landing-page/server.js for why that
# separation still matters even though the lifecycle is now shared.

# Reads the Landing Page's own port the same layered way
# landing-page/server.js itself does (v1.1.3 override file, then the
# shared landingPagePort config key, then 80) - kept as its own small
# function rather than importing server.js's logic, since this is
# PowerShell reading the same two small JSON files, not JavaScript.
function Get-DexLandingPagePort {
  try {
    $legacyPath = Join-Path $AppRoot "landing-page\data\landing-config.json"
    if (Test-Path $legacyPath) {
      $legacy = Get-Content $legacyPath -Raw | ConvertFrom-Json
      if ($legacy.port) { return [int]$legacy.port }
    }
  } catch {}
  try {
    $cfg = Get-DexConfig
    if ($cfg.landingPagePort) { return [int]$cfg.landingPagePort }
  } catch {}
  return 80
}

# Same "kill anything already on this port, PID-4-safe" shape as
# Clear-DexNodeProcess above, but scoped to the Landing Page's own port
# instead of the main app's. PID 4 ("System") means Windows' own
# http.sys has the port reserved (usually IIS/"World Wide Web
# Publishing Service") - not a stray copy of this app, and not a real
# process that can/should be killed.
function Clear-DexLandingPageProcess {
  $port = Get-DexLandingPagePort
  try {
    $lines = netstat -ano | Select-String ":$port " | Select-String "LISTENING"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
      $procId = $parts[-1]
      if ($procId -ne '4') { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
  Start-Sleep -Milliseconds 300
}

# One-time-per-process-start check: is the Landing Page's firewall rule
# already there? If so, do nothing at all - no prompt, no elevation,
# completely silent (this is the common case for anyone who already ran
# v1.1.3's install-landing.bat, or has been through this once before on
# v1.1.4). If it's genuinely missing (a brand new install, or someone
# jumping straight from an old pre-1.1.3 version), request admin rights
# JUST for the one netsh command that adds it - explicit ask: "dex labs
# ask admin permission for it [...] if you need admin permission ask for
# it from the user when needed". This spawns a tiny separate elevated
# process for that single command (via the standard, known-working
# `Start-Process -Verb RunAs` self-elevation idiom) rather than
# re-launching the whole tray elevated - the tray itself keeps running
# at normal/non-admin privilege the entire time, only that one command
# runs elevated, briefly, in its own process.
#
# Deliberately only called from Start-DexLandingPage's normal startup
# path (tray launch, post-update restart, Settings toggle) - NEVER from
# the watchdog's crash-restart check or the silent background
# auto-update timer, so this can never surprise someone with a UAC
# prompt while they're not at the PC. Startup/update moments are always
# tied to an active, present user session (someone just logged in,
# clicked a shortcut, or is watching an interactive update dialog).
function Ensure-DexLandingPageFirewall {
  param([int]$Port)
  try {
    $existing = netsh advfirewall firewall show rule name="DexLabsLandingPage80" 2>$null
    if ($LASTEXITCODE -eq 0 -and $existing) {
      return # already set up - nothing to do, nothing to ask
    }
  } catch {}

  Write-DexLog "Landing Page firewall rule not found - requesting admin permission to add it (port $Port)."
  try {
    # No embedded quotes in this arguments string at all (the rule name
    # has no spaces, so none are needed) - deliberately sidesteps the
    # "Start-Process -ArgumentList mangles manually-embedded quotes"
    # class of bug documented in PROJECT_BRIEFING.md (that one was
    # triggered by a path containing a space; this has no paths and no
    # quotes to mangle in the first place).
    $netshArgs = "advfirewall firewall add rule name=DexLabsLandingPage80 dir=in action=allow protocol=TCP localport=$Port"
    Start-Process -FilePath "netsh.exe" -ArgumentList $netshArgs -Verb RunAs -WindowStyle Hidden -Wait
    Write-DexLog "Landing Page firewall rule added (or the user declined the permission prompt)."
  } catch {
    Write-DexLog "[WARNING] Could not add the Landing Page firewall rule (user may have declined the permission prompt, or something else went wrong): $_. The Landing Page will still work for devices already trusted/on this PC, but other devices on the WiFi may not be able to reach it until this is granted - toggle Landing Page off then on again from the tray menu to retry."
  }
}

$script:LandingPageProcess = $null
$script:LandingPageOutputSubs = @()

function Start-DexLandingPage {
  $cfg = Get-DexConfig
  if (-not $cfg.landingPageEnabled) {
    Write-DexLog "Landing Page is turned off (tray menu) - not starting it."
    return
  }
  $landingPageRoot = Join-Path $AppRoot "landing-page"
  $landingPageScript = Join-Path $landingPageRoot "server.js"
  if (-not (Test-Path $landingPageScript)) {
    Write-DexLog "[WARNING] landing-page\server.js not found - skipping (this install may predate v1.1.4, or the folder was removed)."
    return
  }

  Clear-DexLandingPageProcess
  $port = Get-DexLandingPagePort
  Ensure-DexLandingPageFirewall -Port $port

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = "server.js"
  $psi.WorkingDirectory = $landingPageRoot
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $proc.EnableRaisingEvents = $true

  # Reuses the exact same logs.txt as the main server (see the
  # OutputDataReceived handler in Start-DexServer above) - the Landing
  # Page's own console.log lines already say what they are (e.g. "DEX
  # Labs Landing Page running..."), so one combined log stays readable
  # via the same Console menu item without needing a second log viewer.
  $handler = {
    if ($null -ne $Event.SourceEventArgs.Data) {
      $logPath = $Event.MessageData
      try { Add-Content -Path $logPath -Value $Event.SourceEventArgs.Data -ErrorAction SilentlyContinue } catch {}
    }
  }
  $script:LandingPageOutputSubs += Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action $handler -MessageData $LogPath
  $script:LandingPageOutputSubs += Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action $handler -MessageData $LogPath

  try {
    $proc.Start() | Out-Null
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $script:LandingPageProcess = $proc
    Write-DexLog "=== Landing Page started (PID $($proc.Id), port $port) ==="
  } catch {
    Write-DexLog "[ERROR] Landing Page failed to start: $_"
    $script:LandingPageProcess = $null
  }
}

function Stop-DexLandingPage {
  foreach ($sub in $script:LandingPageOutputSubs) {
    try { Unregister-Event -SourceIdentifier $sub.Name -ErrorAction SilentlyContinue } catch {}
  }
  $script:LandingPageOutputSubs = @()
  if ($script:LandingPageProcess -and -not $script:LandingPageProcess.HasExited) {
    try { $script:LandingPageProcess.Kill() } catch {}
  }
  Clear-DexLandingPageProcess
  $script:LandingPageProcess = $null
  Write-DexLog "=== Landing Page stopped ==="
}

# ---------- disposable console/log viewer (separate process, on purpose) ----------
$script:ConsoleViewerProcess = $null
function Show-DexConsoleViewer {
  if ($script:ConsoleViewerProcess -and -not $script:ConsoleViewerProcess.HasExited) {
    return # already open - closing/reopening is the user's call, don't spawn a duplicate
  }
  # Built and passed via -EncodedCommand (base64) rather than a quoted
  # -Command string - this was the actual bug: Start-Process -ArgumentList
  # mangles manually-embedded quotes when the underlying path contains a
  # space (very common - e.g. "C:\Users\name\Documents\DEX labs"), which
  # broke Get-Content's -Path argument. Encoding the whole script sidesteps
  # shell-quoting entirely, regardless of what's in the path.
  $scriptText = @"
Write-Host 'DEX Labs Console - this window is separate from the app.'
Write-Host 'Closing it does NOT stop the server. Live output below:'
Write-Host '========================================'
Get-Content -Path '$LogPath' -Wait -Tail 80
"@
  $encodedCommand = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($scriptText))
  try {
    $script:ConsoleViewerProcess = Start-Process -FilePath "powershell.exe" `
      -ArgumentList @("-NoProfile", "-NoExit", "-EncodedCommand", $encodedCommand) -PassThru
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Could not open the console window: $_", "DEX Labs", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
}

Clear-DuplicateTrayInstances
Start-DexServer
Start-DexLandingPage

# ---------- version comparison ----------
function Test-VersionNewer($NewVersion, $CurrentVer) {
  $n = @($NewVersion -split '\.' | ForEach-Object { [int]$_ })
  $c = @($CurrentVer -split '\.' | ForEach-Object { [int]$_ })
  $len = [Math]::Max($n.Count, $c.Count)
  for ($i = 0; $i -lt $len; $i++) {
    $nv = if ($i -lt $n.Count) { $n[$i] } else { 0 }
    $cv = if ($i -lt $c.Count) { $c[$i] } else { 0 }
    if ($nv -gt $cv) { return $true }
    if ($nv -lt $cv) { return $false }
  }
  return $false
}

# ---------- auto-update: shared logic used by both the manual "Check for
# Updates (Auto)" menu item AND the silent 5-minute background timer ----------

# Asks GitHub what the latest release is. Returns a hashtable describing
# the outcome rather than throwing, so callers (interactive or silent)
# can each decide how to present it:
#   @{ ok = $true; newVer = '1.0.4'; asset = <release asset object> }
#   @{ ok = $false; reason = 'network' | 'no-release' | 'no-asset'; detail = '...' }
function Get-DexLatestReleaseInfo {
  $apiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
  try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "DEX-Labs-Updater"; "Accept" = "application/vnd.github+json" } -TimeoutSec 20
  } catch {
    return @{ ok = $false; reason = "network"; detail = "$_" }
  }
  $tagName = $release.tag_name
  if ([string]::IsNullOrWhiteSpace($tagName)) {
    return @{ ok = $false; reason = "no-release" }
  }
  $newVer = $tagName.TrimStart('v', 'V')
  $asset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
  if (-not $asset) {
    return @{ ok = $false; reason = "no-asset"; newVer = $newVer }
  }
  return @{ ok = $true; newVer = $newVer; asset = $asset }
}

# "Only auto-update when no timer or any subsystem is running" - checked
# two ways: timers are read directly from data/timers.json (local file,
# no round trip needed, and works even if the server were unresponsive),
# and in-flight AirDrop/Lesson-Tracker uploads are asked from the running
# server itself via GET /api/busy (only the server process actually knows
# about requests currently mid-upload). If the server can't be reached at
# all, that's treated as "not idle" - safer to skip a cycle than update
# underneath something we couldn't verify.
function Test-DexSystemIdle {
  try {
    $timersPath = Join-Path $AppRoot "data\timers.json"
    if (Test-Path $timersPath) {
      $timersData = Get-Content $timersPath -Raw | ConvertFrom-Json
      $activeTimer = $timersData.timers | Where-Object { $_.status -eq 'running' -or $_.status -eq 'ringing' } | Select-Object -First 1
      if ($activeTimer) { return @{ idle = $false; reason = "a timer/alarm is running or ringing" } }
    }
  } catch {}

  try {
    $busy = Invoke-RestMethod -Uri "http://localhost:$($script:CurrentPort)/api/busy" -TimeoutSec 5
    if ($busy.busy) { return @{ idle = $false; reason = ($busy.reasons -join ', ') } }
  } catch {
    return @{ idle = $false; reason = "could not confirm the server is idle" }
  }

  return @{ idle = $true }
}

# ---------- v1.0.5: subsystem show/hide dialog ----------
# Reads the canonical subsystem list from the server itself (GET
# /api/settings/subsystems) rather than keeping a second hardcoded copy
# here - lib/subsystems-registry.js on the Node side is the single
# source of truth a future session extends when adding subsystem #5, #6,
# ... #30+; this dialog just reflects whatever it returns, so it never
# needs editing when a new subsystem is added.
function Show-DexSubsystemsDialog {
  $port = $script:CurrentPort
  try {
    $data = Invoke-RestMethod -Uri "http://localhost:$port/api/settings/subsystems" -TimeoutSec 5
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Could not reach the DEX Labs server to load the subsystem list. Make sure it's running, then try Settings again.", "DEX Labs", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    return
  }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "DEX Labs - Show/Hide Subsystems"
  $form.Width = 380
  $form.Height = 420
  $form.StartPosition = "CenterScreen"
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false

  $label = New-Object System.Windows.Forms.Label
  $label.Text = "Untick anything you want hidden from the site's menu:"
  $label.Left = 12; $label.Top = 10; $label.Width = 340; $label.Height = 20
  $form.Controls.Add($label)

  # Scrollable so this still works cleanly once there are 30+ entries,
  # not just today's 4.
  $checklist = New-Object System.Windows.Forms.CheckedListBox
  $checklist.Left = 12; $checklist.Top = 34; $checklist.Width = 340; $checklist.Height = 220
  $checklist.CheckOnClick = $true
  foreach ($s in $data.subsystems) {
    $idx = $checklist.Items.Add($s.label)
    $isHidden = $data.hiddenSubsystems -contains $s.id
    $checklist.SetItemChecked($idx, -not $isHidden)
  }
  $form.Controls.Add($checklist)

  $comboLabel = New-Object System.Windows.Forms.Label
  $comboLabel.Text = "Show this first when the site loads:"
  $comboLabel.Left = 12; $comboLabel.Top = 262; $comboLabel.Width = 340; $comboLabel.Height = 20
  $form.Controls.Add($comboLabel)

  $combo = New-Object System.Windows.Forms.ComboBox
  $combo.Left = 12; $combo.Top = 284; $combo.Width = 340
  $combo.DropDownStyle = "DropDownList"
  function Update-DexLandingComboOptions {
    $prevSelected = $combo.SelectedItem
    $combo.Items.Clear()
    for ($i = 0; $i -lt $checklist.Items.Count; $i++) {
      if ($checklist.GetItemChecked($i)) { $combo.Items.Add($data.subsystems[$i].label) | Out-Null }
    }
    if ($combo.Items.Count -gt 0) {
      if ($prevSelected -and $combo.Items.Contains($prevSelected)) { $combo.SelectedItem = $prevSelected }
      else { $combo.SelectedIndex = 0 }
    }
  }
  $checklist.Add_ItemCheck({
    # ItemCheck fires BEFORE the check state actually applies - defer the
    # combo refresh a tick so it sees the new state, not the old one.
    $form.BeginInvoke([Action]{ Update-DexLandingComboOptions }) | Out-Null
  })
  Update-DexLandingComboOptions
  $currentLandingLabel = ($data.subsystems | Where-Object { $_.id -eq $data.defaultLandingSubsystem } | Select-Object -First 1).label
  if ($currentLandingLabel -and $combo.Items.Contains($currentLandingLabel)) { $combo.SelectedItem = $currentLandingLabel }
  $form.Controls.Add($combo)

  $okBtn = New-Object System.Windows.Forms.Button
  $okBtn.Text = "Save"
  $okBtn.Left = 196; $okBtn.Top = 330; $okBtn.Width = 75
  $okBtn.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Controls.Add($okBtn)

  $cancelBtn = New-Object System.Windows.Forms.Button
  $cancelBtn.Text = "Cancel"
  $cancelBtn.Left = 277; $cancelBtn.Top = 330; $cancelBtn.Width = 75
  $cancelBtn.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $form.Controls.Add($cancelBtn)

  $form.AcceptButton = $okBtn
  $form.CancelButton = $cancelBtn

  if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }

  $hiddenIds = @()
  for ($i = 0; $i -lt $checklist.Items.Count; $i++) {
    if (-not $checklist.GetItemChecked($i)) { $hiddenIds += $data.subsystems[$i].id }
  }
  if ($hiddenIds.Count -ge $data.subsystems.Count) {
    [System.Windows.Forms.MessageBox]::Show("At least one subsystem has to stay visible - nothing was changed.", "DEX Labs", 0, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    return
  }
  $landingLabel = $combo.SelectedItem
  $landingId = ($data.subsystems | Where-Object { $_.label -eq $landingLabel } | Select-Object -First 1).id
  if (-not $landingId) { $landingId = ($data.subsystems | Where-Object { $hiddenIds -notcontains $_.id } | Select-Object -First 1).id }

  $body = @{ hiddenSubsystems = $hiddenIds; defaultLandingSubsystem = $landingId } | ConvertTo-Json
  try {
    Invoke-RestMethod -Uri "http://localhost:$port/api/settings/subsystems" -Method Put -ContentType "application/json" -Body $body -TimeoutSec 5 | Out-Null
    Write-DexLog "=== Subsystem visibility updated: hidden=[$($hiddenIds -join ', ')], landing=$landingId ==="
    [System.Windows.Forms.MessageBox]::Show("Saved. The website's menu will reflect this the next time it loads.", "DEX Labs", 0, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Could not save - the server may be busy or unreachable. Try again. Details: $_", "DEX Labs", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
}

# ---------- v1.0.5: crash-restart watchdog ("the auto start system") ----------
# Runs on its own short-interval timer (independent of the 5-minute
# update-check timer). Job: if the Node server process has died - crashed,
# got killed some other way, anything besides a deliberate update-driven
# stop - bring it back up automatically, without the user having to
# notice or do anything.
#
# The one thing it must NOT do is fight with an update that's legitimately
# in progress (Stop-DexServer -> apply-update.ps1 -> Start-DexServer is a
# normal sequence during which the server is briefly, deliberately, not
# running). $script:UpdateInProgress is the signal for that. But an update
# should only ever take a few seconds - if it's still "in progress" more
# than 15 seconds after it started, something's wrong (stuck apply-
# update.ps1, a hung npm install, etc.), and at that point the watchdog
# stops deferring and restarts the server anyway, same as any other crash.
# This is the "maximum update time is 15s" behavior.
$script:WatchdogGraceMs = 15000
function Invoke-DexWatchdogCheck {
  if ($script:UpdateInProgress) {
    $elapsedMs = if ($script:UpdateStartedAt) { ((Get-Date) - $script:UpdateStartedAt).TotalMilliseconds } else { 0 }
    if ($elapsedMs -lt $script:WatchdogGraceMs) {
      return # a real update is (probably) still legitimately mid-flight - leave it alone
    }
    Write-DexLog "[WATCHDOG] Update has been marked in-progress for $([int]($elapsedMs / 1000))s (>15s) - treating as stuck/finished, resuming normal crash checks."
  }

  $isDown = ($null -eq $script:ServerProcess) -or $script:ServerProcess.HasExited
  if (-not $isDown) { return } # normal case - server's alive, nothing to do

  Write-DexLog "[WATCHDOG] DEX Labs server is not running - restarting automatically."
  if ($notifyIcon) {
    try {
      $notifyIcon.BalloonTipTitle = "DEX Labs restarted itself"
      $notifyIcon.BalloonTipText = "The server had stopped running (crash or unexpected exit) - the watchdog just started it back up."
      $notifyIcon.ShowBalloonTip(8000)
    } catch {}
  }
  try { Start-DexServer } catch { Write-DexLog "[ERROR] Watchdog restart attempt failed: $_" }
}

# v1.1.4: same idea as the main server check above, but for the Landing
# Page - independent process, independent check (the main server being
# down doesn't mean the Landing Page is, and vice versa). Re-reads the
# enabled flag fresh each tick so toggling it off from the tray menu
# takes effect immediately rather than having the watchdog fight it by
# restarting a process the user just turned off. No balloon tip for
# this one (unlike the main server above) - the Landing Page is a nice-
# to-have front door, not something worth interrupting the user over
# every time it blips.
function Invoke-DexLandingPageWatchdogCheck {
  if ($script:UpdateInProgress) { return } # same "don't fight a real update" guard as the main check
  $cfg = Get-DexConfig
  if (-not $cfg.landingPageEnabled) { return }
  if (-not (Test-Path (Join-Path $AppRoot "landing-page\server.js"))) { return }

  $isDown = ($null -eq $script:LandingPageProcess) -or $script:LandingPageProcess.HasExited
  if (-not $isDown) { return }

  Write-DexLog "[WATCHDOG] Landing Page is not running (and is enabled) - restarting automatically."
  try { Start-DexLandingPage } catch { Write-DexLog "[ERROR] Landing Page watchdog restart attempt failed: $_" }
}

# Relaunches DEX Labs as a brand new tray.ps1 process (same mechanism as
# the Desktop/Start Menu shortcuts - see run-hidden.vbs), then exits this
# process. This is the "close the tray and open a tray" full restart -
# distinct from the ordinary Start-DexServer/Stop-DexServer pair, which
# only cycles the Node child process without restarting tray.ps1 itself.
# Does not return - the current process exits from inside this function.
function Restart-DexTrayProcess {
  Write-DexLog "=== Restarting DEX Labs tray (fresh process) after update ==="
  try {
    if ($script:ConsoleViewerProcess -and -not $script:ConsoleViewerProcess.HasExited) {
      try { $script:ConsoleViewerProcess.CloseMainWindow() | Out-Null } catch {}
    }
    if ($notifyIcon) { $notifyIcon.Visible = $false }
    $vbsPath = Join-Path $AppRoot "run-hidden.vbs"
    if (Test-Path $vbsPath) {
      Start-Process -FilePath "wscript.exe" -ArgumentList @("//nologo", "`"$vbsPath`"")
    } else {
      Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $AppRoot 'tray.ps1')`"")
    }
  } catch {
    Write-DexLog "[ERROR] Could not relaunch tray after update: $_"
  }
  [System.Windows.Forms.Application]::Exit()
}

# The one place that actually applies a downloaded update zip - shared by
# both the manual Auto check and the background timer. Always backs up
# first (that's apply-update.ps1's job, unconditionally). Deletes the
# downloaded zip once apply-update.ps1 has read it, success or not.
# -RelaunchTray makes this do the full "close tray, open tray" restart on
# success instead of just cycling the Node child process in place -
# used by the background path per the "restart the whole system" ask.
function Install-DexUpdateFromDownloadedZip {
  param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$NewVer,
    [switch]$RelaunchTray
  )
  Write-DexLog "=== Applying update: -> v$NewVer ==="
  Stop-DexServer
  Stop-DexLandingPage

  $applyScript = Join-Path $AppRoot "apply-update.ps1"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $applyScript -ZipPath $ZipPath *>&1 | ForEach-Object {
    try { Add-Content -Path $LogPath -Value $_ -ErrorAction SilentlyContinue } catch {}
  }
  $exitCode = $LASTEXITCODE
  try { Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue } catch {}

  if ($exitCode -eq 0) {
    Write-DexLog "=== Update applied OK: now v$NewVer ==="
    if ($RelaunchTray) {
      Restart-DexTrayProcess # does not return - the new tray.ps1 process starts both the server and Landing Page itself
    } else {
      Start-DexServer
      Start-DexLandingPage
    }
    return $true
  } else {
    Write-DexLog "[WARNING] Update apply exited non-zero for v$NewVer"
    Start-DexServer
    Start-DexLandingPage
    return $false
  }
}

$script:AutoUpdateEnabled = (Get-DexConfig).autoUpdate
$script:UpdateInProgress = $false
# v1.0.5: timestamp of when $script:UpdateInProgress last flipped to
# $true - the watchdog (below) uses this to give an in-progress update up
# to 15 seconds of "don't touch it" grace before deciding it's actually
# stuck/finished and resuming normal crash-restart behavior. See
# Invoke-DexWatchdogCheck.
$script:UpdateStartedAt = $null
$script:LastBackgroundNotifiedVersion = $null

# Runs on the 5-minute timer. Stays completely silent when there's
# nothing to report (up to date, or a transient network hiccup) - only
# speaks up (balloon tip) when it's actually about to install something,
# or once per newly-seen version if it's waiting on busy timers/uploads.
function Invoke-BackgroundUpdateCheck {
  if (-not $script:AutoUpdateEnabled) { return }
  if ($script:UpdateInProgress) { return } # a manual check/install is already running - don't overlap

  $info = Get-DexLatestReleaseInfo
  if (-not $info.ok) {
    if ($info.reason -eq "network") { Write-DexLog "Background update check: could not reach GitHub ($($info.detail))" }
    return
  }

  $currentVer = Get-CurrentVersion
  if (-not (Test-VersionNewer -NewVersion $info.newVer -CurrentVer $currentVer)) {
    return # up to date - nothing to do or say
  }

  $idleCheck = Test-DexSystemIdle
  if (-not $idleCheck.idle) {
    if ($script:LastBackgroundNotifiedVersion -ne $info.newVer) {
      Write-DexLog "Background update check: v$($info.newVer) is available but DEX Labs is busy ($($idleCheck.reason)) - will retry in $([int]($UpdateCheckIntervalMs / 60000)) min."
      $script:LastBackgroundNotifiedVersion = $info.newVer
    }
    return
  }

  $script:UpdateInProgress = $true
  $script:UpdateStartedAt = Get-Date
  try {
    $currentVer = Get-CurrentVersion
    if ($notifyIcon) {
      $notifyIcon.BalloonTipTitle = "DEX Labs update available"
      $notifyIcon.BalloonTipText = "DEX Labs has released v$($info.newVer) - you have v$currentVer, so it's time to update. Installing now..."
      $notifyIcon.ShowBalloonTip(8000)
    }
    Write-DexLog "Background auto-update: v$($info.newVer) available (you have v$currentVer), system idle - installing."

    $downloadPath = Join-Path $env:TEMP "dexlabs-update-$($info.newVer).zip"
    try {
      Invoke-WebRequest -Uri $info.asset.browser_download_url -OutFile $downloadPath -Headers @{ "User-Agent" = "DEX-Labs-Updater" } -TimeoutSec 300
    } catch {
      Write-DexLog "[ERROR] Background auto-update download failed: $_"
      return
    }

    # On success this relaunches the tray and does not return.
    $ok = Install-DexUpdateFromDownloadedZip -ZipPath $downloadPath -NewVer $info.newVer -RelaunchTray
    if (-not $ok -and $notifyIcon) {
      $notifyIcon.BalloonTipTitle = "DEX Labs update problem"
      $notifyIcon.BalloonTipText = "The auto-update to v$($info.newVer) ran into a problem - check Console/logs.txt. Your data was backed up first."
      $notifyIcon.ShowBalloonTip(10000)
    }
  } finally {
    $script:UpdateInProgress = $false
  }
}

# ---------- tray icon + menu ----------
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $IconPath) {
  $notifyIcon.Icon = New-Object System.Drawing.Icon($IconPath)
} else {
  $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}
$notifyIcon.Text = "$DisplayLabel (port $($script:CurrentPort))"
$notifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$menuOpen = $contextMenu.Items.Add("Open DEX Labs")
$contextMenu.Items.Add("-") | Out-Null
$menuConsole = $contextMenu.Items.Add("Console")

# "Update" is now a submenu with two entry points: check GitHub
# automatically, or pick a zip by hand (the original behavior, unchanged).
# Both funnel into the exact same backup/extract/install machinery
# (apply-update.ps1) - only how the zip and target version are decided
# differs between them.
$menuUpdate = New-Object System.Windows.Forms.ToolStripMenuItem "Update"
$menuUpdateAuto = New-Object System.Windows.Forms.ToolStripMenuItem "Check for Updates (Auto)"
$menuUpdateManual = New-Object System.Windows.Forms.ToolStripMenuItem "Select Update File (Manual)"
$menuUpdate.DropDownItems.Add($menuUpdateAuto) | Out-Null
$menuUpdate.DropDownItems.Add($menuUpdateManual) | Out-Null
$menuUpdate.DropDownItems.Add("-") | Out-Null
# Background auto-update toggle - checked state reflects data/config.json
# and is preserved across restarts/updates. "Keep option for auto update":
# this is that option, on by default.
$menuUpdateToggle = New-Object System.Windows.Forms.ToolStripMenuItem "Auto-Update (checks every 5 min)"
$menuUpdateToggle.CheckOnClick = $true
$menuUpdateToggle.Checked = $script:AutoUpdateEnabled
$menuUpdate.DropDownItems.Add($menuUpdateToggle) | Out-Null
$contextMenu.Items.Add($menuUpdate) | Out-Null

$menuSettings = $contextMenu.Items.Add("Settings")
# v1.1.4: on/off switch for the Landing Page (the "type just your IP, no
# port" front page on port 80 - see Start-DexLandingPage). On by
# default, matching the explicit ask that it "just runs" without a
# separate install step - this is here for the rare case someone needs
# port 80 free for something else, or just doesn't want it. Same
# checked-state-reflects-config.json pattern as the Auto-Update toggle
# above.
$script:LandingPageEnabledState = (Get-DexConfig).landingPageEnabled
$menuLandingToggle = New-Object System.Windows.Forms.ToolStripMenuItem "Landing Page (site list on port 80)"
$menuLandingToggle.CheckOnClick = $true
$menuLandingToggle.Checked = $script:LandingPageEnabledState
$contextMenu.Items.Add($menuLandingToggle) | Out-Null
$menuOpenFolder = $contextMenu.Items.Add("Open App Folder")
$contextMenu.Items.Add("-") | Out-Null
$menuVersion = $contextMenu.Items.Add($DisplayLabel)
$menuVersion.Enabled = $false
$contextMenu.Items.Add("-") | Out-Null
$menuExit = $contextMenu.Items.Add("Exit")
$notifyIcon.ContextMenuStrip = $contextMenu

function Open-DexInBrowser {
  try { Start-Process "http://localhost:$($script:CurrentPort)" } catch {}
}
function Open-DexAppFolder {
  try { Start-Process "explorer.exe" -ArgumentList $AppRoot } catch {}
}

# Left-click does the thing you'd actually want most often - see the
# site. Console/Update/Settings/Exit stay in the right-click menu since
# they're less frequent, more deliberate actions.
$menuOpen.Add_Click({ Open-DexInBrowser })
$notifyIcon.Add_MouseClick({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-DexInBrowser }
})
$menuConsole.Add_Click({ Show-DexConsoleViewer })
$menuOpenFolder.Add_Click({ Open-DexAppFolder })

$menuUpdateAuto.Add_Click({
  if ($script:UpdateInProgress) {
    [System.Windows.Forms.MessageBox]::Show("An update is already being checked or installed - try again in a moment.", "DEX Labs", 0, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    return
  }
  Write-DexLog "=== Manual update check started ==="
  $currentVer = Get-CurrentVersion
  $info = Get-DexLatestReleaseInfo

  if (-not $info.ok) {
    switch ($info.reason) {
      "network" { [System.Windows.Forms.MessageBox]::Show("Could not check for updates - make sure this PC is connected to the internet.`n`nDetails: $($info.detail)", "Update check failed", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null }
      "no-release" { [System.Windows.Forms.MessageBox]::Show("No releases were found on GitHub yet ($RepoOwner/$RepoName).", "No updates available", 0, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null }
      "no-asset" { [System.Windows.Forms.MessageBox]::Show("Found release v$($info.newVer) on GitHub, but it has no .zip file attached - nothing to install.", "Update failed", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null }
      default { [System.Windows.Forms.MessageBox]::Show("Could not check for updates.", "Update check failed", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null }
    }
    Write-DexLog "Manual update check failed/no-op: $($info.reason)"
    return
  }

  if (-not (Test-VersionNewer -NewVersion $info.newVer -CurrentVer $currentVer)) {
    [System.Windows.Forms.MessageBox]::Show("DEX Labs has released v$($info.newVer) - and you have the latest, v$currentVer. Nothing to update.", "Up to date", 0, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Write-DexLog "Manual update check: already up to date (v$currentVer, latest is v$($info.newVer))"
    return
  }

  $confirm = [System.Windows.Forms.MessageBox]::Show(
    "DEX Labs has released v$($info.newVer) - you have v$currentVer, so it's time to update.`n`nDownload and install it now?`n`nYour lessons, tutes, AirDrop files, schedule, timers, and settings will be backed up automatically before anything changes. The server will restart when it's done.",
    "Update available", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question
  )
  if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) {
    Write-DexLog "Manual update: user declined v$($info.newVer)"
    return
  }

  $script:UpdateInProgress = $true
  $script:UpdateStartedAt = Get-Date
  try {
    $downloadPath = Join-Path $env:TEMP "dexlabs-update-$($info.newVer).zip"
    try {
      Invoke-WebRequest -Uri $info.asset.browser_download_url -OutFile $downloadPath -Headers @{ "User-Agent" = "DEX-Labs-Updater" } -TimeoutSec 300
      Write-DexLog "Manual update: downloaded v$($info.newVer) to $downloadPath"
    } catch {
      [System.Windows.Forms.MessageBox]::Show("Could not download the update file.`n`nDetails: $_", "Update failed", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
      Write-DexLog "[ERROR] Manual update download failed: $_"
      return
    }

    $ok = Install-DexUpdateFromDownloadedZip -ZipPath $downloadPath -NewVer $info.newVer
    if ($ok) {
      [System.Windows.Forms.MessageBox]::Show("The latest update (v$($info.newVer)) is installed - OK. Server restarted.`n`nA backup of your previous data is in the 'backups' folder.", "Update complete", 0, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } else {
      [System.Windows.Forms.MessageBox]::Show("The update ran into a problem - click Console to see details. Your data was backed up before anything changed - check the 'backups' folder if anything looks wrong. The server has been restarted with whatever is currently on disk.", "Update finished with warnings", 0, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    }
  } finally {
    $script:UpdateInProgress = $false
  }
})

$menuUpdateToggle.Add_Click({
  $script:AutoUpdateEnabled = $menuUpdateToggle.Checked
  Set-DexConfigAutoUpdate -Enabled $script:AutoUpdateEnabled
  Write-DexLog "Background auto-update turned $(if ($script:AutoUpdateEnabled) { 'ON' } else { 'OFF' })"
})

# v1.1.4: unlike most other settings here, this one takes effect
# immediately (start/stop the actual process right now) rather than
# only on next restart - toggling something "on" and having nothing
# visibly happen until some later restart would just look broken.
$menuLandingToggle.Add_Click({
  $script:LandingPageEnabledState = $menuLandingToggle.Checked
  Set-DexConfigLandingPage -Enabled $script:LandingPageEnabledState
  Write-DexLog "Landing Page turned $(if ($script:LandingPageEnabledState) { 'ON' } else { 'OFF' }) (tray menu)"
  if ($script:LandingPageEnabledState) {
    Start-DexLandingPage
  } else {
    Stop-DexLandingPage
  }
})

$menuUpdateManual.Add_Click({
  $ofd = New-Object System.Windows.Forms.OpenFileDialog
  $ofd.Filter = "DEX Labs update (*.zip)|*.zip"
  $ofd.Title = "Select a DEX Labs update file"
  if ($ofd.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
  $zipPath = $ofd.FileName

  $currentVer = Get-CurrentVersion
  $newVer = $null
  try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    $pkgEntry = $zip.Entries | Where-Object { $_.FullName -eq "package.json" } | Select-Object -First 1
    if (-not $pkgEntry) {
      $zip.Dispose()
      [System.Windows.Forms.MessageBox]::Show("That zip doesn't look like a DEX Labs update - no package.json found at its root.", "Update failed", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
      return
    }
    $reader = New-Object System.IO.StreamReader($pkgEntry.Open())
    $newPkgText = $reader.ReadToEnd()
    $reader.Close()
    $zip.Dispose()
    $newPkg = $newPkgText | ConvertFrom-Json
    $newVer = $newPkg.version
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Could not read that update file: $_", "Update failed", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    return
  }

  if (-not (Test-VersionNewer -NewVersion $newVer -CurrentVer $currentVer)) {
    [System.Windows.Forms.MessageBox]::Show("Selected update (v$newVer) is not newer than the currently installed version (v$currentVer). Update cancelled.", "Update cancelled", 0, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    return
  }

  $confirm = [System.Windows.Forms.MessageBox]::Show(
    "Update from v$currentVer to v$newVer?`n`nYour lessons, tutes, AirDrop files, schedule, timers, and settings will be backed up automatically before anything changes. The server will restart when it's done.",
    "Confirm update", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question
  )
  if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }

  Write-DexLog "=== Applying update: v$currentVer -> v$newVer ==="
  # v1.0.5: this manual path previously didn't set $script:UpdateInProgress
  # at all - harmless before the watchdog existed, but now it needs to so
  # the watchdog (which restarts the server if it's found not running)
  # doesn't race with Stop-DexServer/apply-update.ps1 below and try to
  # "helpfully" restart the server mid-update.
  $script:UpdateInProgress = $true
  $script:UpdateStartedAt = Get-Date
  try {
    Stop-DexServer
    Stop-DexLandingPage

    $applyScript = Join-Path $AppRoot "apply-update.ps1"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $applyScript -ZipPath $zipPath *>&1 | ForEach-Object {
      try { Add-Content -Path $LogPath -Value $_ -ErrorAction SilentlyContinue } catch {}
    }
    $updateExitCode = $LASTEXITCODE

    Start-DexServer
    Start-DexLandingPage

    if ($updateExitCode -eq 0) {
      [System.Windows.Forms.MessageBox]::Show("Updated to v$newVer. Server restarted.`n`nA backup of your previous data is in the 'backups' folder.", "Update complete", 0, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } else {
      [System.Windows.Forms.MessageBox]::Show("The update ran into a problem - click Console to see details. Your data was backed up before anything changed - check the 'backups' folder if anything looks wrong. The server has been restarted with whatever is currently on disk.", "Update finished with warnings", 0, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    }
  } finally {
    $script:UpdateInProgress = $false
  }
})

$menuSettings.Add_Click({
  $cfg = Get-DexConfig

  # ---- Port (unchanged behavior from before v1.0.5) ----
  $portInput = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Port DEX Labs runs on (1024-65535).`n`nYou'll need to update any bookmarks/shortcuts on other devices to match after changing this.",
    "DEX Labs Settings - Port", "$($cfg.port)"
  )
  if (-not [string]::IsNullOrWhiteSpace($portInput)) {
    $newPort = 0
    if (-not [int]::TryParse($portInput.Trim(), [ref]$newPort) -or $newPort -lt 1024 -or $newPort -gt 65535) {
      [System.Windows.Forms.MessageBox]::Show("That's not a valid port - use a number between 1024 and 65535. Port left unchanged.", "Invalid port", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } elseif ($newPort -ne $cfg.port) {
      Set-DexConfigPort -NewPort $newPort
      Write-DexLog "=== Port changed: $($cfg.port) -> $newPort ==="
      Stop-DexServer
      Start-DexServer
      # Best-effort firewall rule update - may silently no-op if this
      # process isn't running elevated; that's OK, it just means the user
      # may need to re-run install.bat as Administrator for the firewall
      # to match.
      try {
        netsh advfirewall firewall delete rule name="LessonTracker3002" | Out-Null
        netsh advfirewall firewall add rule name="LessonTracker3002" dir=in action=allow protocol=TCP localport=$newPort | Out-Null
      } catch {}
      [System.Windows.Forms.MessageBox]::Show("Port changed to $newPort and the server restarted. If other devices can't connect, you may need to re-run install.bat as Administrator so the firewall rule updates too.", "Settings saved", 0, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    }
  }

  # ---- v1.0.5: AirDrop max usage + save location ----
  # Same two settings the website's Settings page exposes (PUT
  # /api/settings) - available here too, per the explicit ask that "the
  # user is forced to set those settings" and should be able to do it
  # from the tray as well, not only the browser. Uses a real folder
  # picker (nicer than typing a path) for the save location.
  $cfg = Get-DexConfig # re-read in case the port step changed it
  $maxInput = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Maximum AirDrop usage, in GB (combined total across everything currently sitting in AirDrop at once - not per-file).",
    "DEX Labs Settings - AirDrop max usage", "$($cfg.airdropMaxUsageGB)"
  )
  $newMaxGb = $cfg.airdropMaxUsageGB
  if (-not [string]::IsNullOrWhiteSpace($maxInput)) {
    $parsed = 0.0
    if ([double]::TryParse($maxInput.Trim(), [ref]$parsed) -and $parsed -gt 0) {
      $newMaxGb = $parsed
    } else {
      [System.Windows.Forms.MessageBox]::Show("That's not a valid number of GB - AirDrop max usage left unchanged.", "Invalid value", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
  }

  $changeLocation = [System.Windows.Forms.MessageBox]::Show(
    "AirDrop currently saves to:`n$(if ($cfg.airdropSaveLocation) { $cfg.airdropSaveLocation } else { '(default) ' + (Join-Path $AppRoot 'uploads-airdrop') })`n`nPick a different folder now?",
    "AirDrop save location", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question
  )
  $newLocation = $cfg.airdropSaveLocation
  if ($changeLocation -eq [System.Windows.Forms.DialogResult]::Yes) {
    $fbd = New-Object System.Windows.Forms.FolderBrowserDialog
    $fbd.Description = "Choose a folder for AirDrop to save files to (Cancel to keep the default)"
    if ($fbd.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      $newLocation = $fbd.SelectedPath
    }
  }

  Set-DexConfigAirdrop -MaxUsageGB $newMaxGb -SaveLocation $newLocation
  Write-DexLog "=== AirDrop settings updated: maxUsageGB=$newMaxGb, saveLocation='$newLocation' ==="
  [System.Windows.Forms.MessageBox]::Show("AirDrop settings saved - max usage $newMaxGb GB, save location: $(if ($newLocation) { $newLocation } else { '(default)' }). Takes effect immediately, no restart needed.", "Settings saved", 0, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null

  # ---- v1.0.5: which subsystems are visible in the site's menu ----
  Show-DexSubsystemsDialog
})

$menuExit.Add_Click({
  Write-DexLog "=== Exit requested from tray menu ==="
  Stop-DexServer
  Stop-DexLandingPage
  if ($script:ConsoleViewerProcess -and -not $script:ConsoleViewerProcess.HasExited) {
    try { $script:ConsoleViewerProcess.CloseMainWindow() | Out-Null } catch {}
  }
  $notifyIcon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

# ---------- background auto-update timer ----------
# Ticks every 5 minutes; Invoke-BackgroundUpdateCheck (defined above,
# alongside the rest of the auto-update logic) no-ops instantly if the
# toggle is off, already up to date, or an update/check is already
# mid-flight, so this is cheap to leave running.
$updateTimer = New-Object System.Windows.Forms.Timer
$updateTimer.Interval = $UpdateCheckIntervalMs
$updateTimer.Add_Tick({ Invoke-BackgroundUpdateCheck })
$updateTimer.Start()

# v1.0.5: the crash-restart watchdog ("system service that checks if DEX
# Labs is running"). Ticks every 5 seconds - frequent enough that a crash
# gets noticed and fixed quickly, cheap enough to leave running
# permanently. See Invoke-DexWatchdogCheck above for the update-in-
# progress guard/15s grace period logic.
$watchdogTimer = New-Object System.Windows.Forms.Timer
$watchdogTimer.Interval = 5000
$watchdogTimer.Add_Tick({ Invoke-DexWatchdogCheck; Invoke-DexLandingPageWatchdogCheck })
$watchdogTimer.Start()

# Safety net: make sure the server dies if the tray app is closed some
# other way (log off, task manager kill of this process, etc.). Runs in
# a detached engine-event scope that can't reliably see this script's own
# functions/variables (the same reason the OutputDataReceived handler
# above uses -MessageData instead of closures) - so this uses the same
# pattern: pass what it needs in via -MessageData, read it back via
# $Event.MessageData, self-contained rather than calling back into
# Stop-DexServer.
Register-EngineEvent PowerShell.Exiting -Action {
  try {
    $root = $Event.MessageData
    $cfgPath = Join-Path $root "data\config.json"
    $port = 3002
    if (Test-Path $cfgPath) {
      try { $port = [int]((Get-Content $cfgPath -Raw | ConvertFrom-Json).port) } catch {}
    }
    $lines = netstat -ano | Select-String ":$port " | Select-String "LISTENING"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
      Stop-Process -Id $parts[-1] -Force -ErrorAction SilentlyContinue
    }
  } catch {}
  # v1.1.4: same safety net, same self-contained reasoning, for the
  # Landing Page's own port - PID 4 ("System") is skipped here too, same
  # as everywhere else this project touches port 80 (see
  # Clear-DexLandingPageProcess for why).
  try {
    $root = $Event.MessageData
    $legacyPath = Join-Path $root "landing-page\data\landing-config.json"
    $cfgPath = Join-Path $root "data\config.json"
    $lpPort = 80
    if (Test-Path $legacyPath) {
      try {
        $v = (Get-Content $legacyPath -Raw | ConvertFrom-Json).port
        if ($v) { $lpPort = [int]$v }
      } catch {}
    } elseif (Test-Path $cfgPath) {
      try {
        $v = (Get-Content $cfgPath -Raw | ConvertFrom-Json).landingPagePort
        if ($v) { $lpPort = [int]$v }
      } catch {}
    }
    $lines = netstat -ano | Select-String ":$lpPort " | Select-String "LISTENING"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
      $procId = $parts[-1]
      if ($procId -ne '4') { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
} -MessageData $AppRoot | Out-Null

[System.Windows.Forms.Application]::Run()

} catch {
  Write-DexLog "[FATAL] Tray app crashed: $_"
  try {
    [System.Windows.Forms.MessageBox]::Show(
      "DEX Labs ran into an unexpected error and needs to close:`n`n$_`n`nCheck logs.txt for details. You can still run the server directly with debug.bat while this gets fixed.",
      "DEX Labs - Fatal Error", 0, [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {}
  try { Stop-DexServer } catch {}
  try { Stop-DexLandingPage } catch {}
}
