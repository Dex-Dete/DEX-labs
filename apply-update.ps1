# Shared update logic - called by tray.ps1's Update menu AND by
# update.bat directly. Kept in one place so there's a single source of
# truth for the backup/extract/install steps rather than two copies that
# could drift apart.
#
# Does NOT stop or restart the server itself, and does NOT check version
# ordering - the caller (tray.ps1 or update.bat) is responsible for that,
# since they each have different ways of talking to the person running
# it. This script just does the mechanical part safely:
#   1. Back up data/uploads (ALWAYS - before touching anything else)
#   2. Extract the new files, but never overwrite data/uploads/backups
#   3. npm install
#
# Exit code 0 = success, non-zero = something went wrong (data is still
# safe either way, since the backup happens first).
param(
  [Parameter(Mandatory = $true)][string]$ZipPath
)

$AppRoot = $PSScriptRoot
$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Host "[ERROR] $msg"
  exit 1
}

if (-not (Test-Path $ZipPath)) {
  Fail "Update file not found: $ZipPath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"

# ---------- 1. Back up current data first, no matter what ----------
$backupDir = Join-Path $AppRoot "backups\backup-$timestamp"
try {
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  foreach ($folder in @("data", "uploads", "uploads-airdrop")) {
    $src = Join-Path $AppRoot $folder
    if (Test-Path $src) {
      Copy-Item -Path $src -Destination (Join-Path $backupDir $folder) -Recurse -Force
    }
  }
  # v1.0.5: AirDrop's save location is now user-configurable
  # (data/config.json's airdropSaveLocation, set via the website's
  # Settings page or the tray's Settings menu) and may point OUTSIDE
  # this project folder entirely - the loop above only backs up the
  # project's own uploads-airdrop/ folder, which would silently miss
  # anything sitting in a custom location. Back that up too, under its
  # own clearly-labeled subfolder, whenever one is configured and
  # actually exists. Non-fatal if this specific step fails (e.g. the
  # custom location is on a drive that's disconnected right now) -
  # the rest of the backup, and the update itself, still proceeds.
  try {
    $configPath = Join-Path $AppRoot "data\config.json"
    if (Test-Path $configPath) {
      $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
      $customLoc = $cfg.airdropSaveLocation
      if ($customLoc -and (Test-Path $customLoc)) {
        Copy-Item -Path $customLoc -Destination (Join-Path $backupDir "uploads-airdrop-custom-location") -Recurse -Force
        Write-Host "[OK] Also backed up custom AirDrop save location: $customLoc"
      }
    }
  } catch {
    Write-Host "[WARNING] Could not back up the custom AirDrop save location (non-fatal - continuing): $_"
  }
  # v1.1.4: AirDrop's save location backup (above) already covers one
  # kind of data living outside the folders in $excludeFolders below.
  # Same idea here for the Landing Page's own saved site list
  # (landing-page/data/sites.json) - it lives INSIDE a folder
  # ("landing-page") that step 3 below wholesale-deletes-and-replaces
  # like any other top-level app folder, so back it up explicitly too.
  # (Step 3 also has its own preserve-and-restore for this - this is
  # belt-and-suspenders in case that step somehow fails partway through.)
  try {
    $landingPageDataPath = Join-Path $AppRoot "landing-page\data"
    if (Test-Path $landingPageDataPath) {
      Copy-Item -Path $landingPageDataPath -Destination (Join-Path $backupDir "landing-page-data") -Recurse -Force
      Write-Host "[OK] Also backed up landing-page/data (saved Landing Page site list)."
    }
  } catch {
    Write-Host "[WARNING] Could not back up landing-page/data (non-fatal - continuing): $_"
  }
  Write-Host "[OK] Backed up data/uploads to: $backupDir"
} catch {
  Fail "Could not back up existing data - stopping BEFORE touching any files, nothing was changed. Error: $_"
}

# ---------- 2. Extract the update to a temp staging folder ----------
$stagingDir = Join-Path $env:TEMP "dexlabs-update-staging-$timestamp"
try {
  if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $stagingDir)
  Write-Host "[OK] Update extracted to staging area."
} catch {
  Fail "Could not extract the update zip. Your data backup is safe at $backupDir. Error: $_"
}

# ---------- 2.5. Preserve landing-page/data across the replace (v1.1.4) ----------
# The main copy loop below (step 3) treats "landing-page" like any other
# top-level app folder: delete what's there, copy in the new zip's
# version wholesale. That's correct for landing-page/server.js, lib/,
# public/ (real app code that should always match the new release) but
# would silently WIPE OUT someone's saved site list
# (landing-page/data/sites.json) on every single update, since that data
# lives nested inside the very folder being replaced - unlike
# data/uploads/uploads-airdrop, which are protected by living at the TOP
# level and being named in $excludeFolders below. Squirrel the existing
# data away here, then restore it back into place after step 3 finishes
# copying in the new landing-page folder.
$landingPageDataPreserve = Join-Path $env:TEMP "dexlabs-landing-data-preserve-$timestamp"
$existingLandingPageData = Join-Path $AppRoot "landing-page\data"
$hasExistingLandingPageData = Test-Path $existingLandingPageData
if ($hasExistingLandingPageData) {
  try {
    Copy-Item -Path $existingLandingPageData -Destination $landingPageDataPreserve -Recurse -Force
    Write-Host "[OK] Preserved existing landing-page/data before update (will be restored after)."
  } catch {
    Write-Host "[WARNING] Could not preserve landing-page/data before the update - a copy should still be safe in the backup at $backupDir if it's needed. Continuing anyway: $_"
    $hasExistingLandingPageData = $false
  }
}

# ---------- 2.6. Make sure nothing is still running out of landing-page/ before touching it (v1.1.4 fix) ----------
# This is what actually caused "Update finished with warnings" the first
# time someone updates from v1.1.3 straight to v1.1.4: this script gets
# invoked by whatever tray.ps1 version happens to be running AT THE TIME
# - and v1.1.3's tray.ps1 has no idea the Landing Page
# (landing-page/server.js) exists as a process to stop before updating
# (that logic didn't exist until v1.1.4). So on a real v1.1.3 machine
# with the Landing Page actually running (started by v1.1.3's own
# separate Startup entry), that node.exe process is still alive, with
# "landing-page" as its current working directory, when step 3 below
# tries to `Remove-Item -Recurse -Force` that entire folder to replace
# it - and Windows refuses to delete a directory that's a running
# process's current working directory, failing the whole update with a
# non-zero exit code.
#
# Fixed by having THIS script kill anything on the Landing Page's port
# itself, unconditionally, right before it's needed - never relying on
# whichever tray.ps1 version called this having already done it. Same
# PID-4-("System"-reserved) safety case used everywhere else this
# project touches port 80.
try {
  $landingPort = 80
  $legacyPortFile = Join-Path $AppRoot "landing-page\data\landing-config.json"
  $mainCfgPath = Join-Path $AppRoot "data\config.json"
  if (Test-Path $legacyPortFile) {
    try {
      $v = (Get-Content $legacyPortFile -Raw | ConvertFrom-Json).port
      if ($v) { $landingPort = [int]$v }
    } catch {}
  } elseif (Test-Path $mainCfgPath) {
    try {
      $v = (Get-Content $mainCfgPath -Raw | ConvertFrom-Json).landingPagePort
      if ($v) { $landingPort = [int]$v }
    } catch {}
  }
  $lines = netstat -ano | Select-String ":$landingPort " | Select-String "LISTENING"
  $killedAny = $false
  foreach ($line in $lines) {
    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
    $procId = $parts[-1]
    if ($procId -ne '4') {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      $killedAny = $true
    }
  }
  if ($killedAny) {
    Start-Sleep -Milliseconds 500 # give Windows a moment to actually release the folder handle
    Write-Host "[OK] Stopped a running Landing Page process on port $landingPort so its folder can be safely replaced."
  }
} catch {
  Write-Host "[WARNING] Could not check/stop anything on the Landing Page's port before updating (non-fatal, continuing): $_"
}

# ---------- 3. Copy new files over, preserving data/uploads/backups ----------
# v1.1.4 fix: this used to be ONE try/catch around the whole loop, so a
# single folder failing to replace (e.g. "landing-page" being locked by
# a still-running old process - see the v1.1.3->v1.1.4 upgrade problem
# below) aborted the ENTIRE update immediately, leaving whatever hadn't
# been reached yet alphabetically - which included tray.ps1, server.js,
# lib/, public/, and package.json - stuck on the OLD version. That's a
# much worse outcome than "one folder didn't update": it left the
# install in a half-updated, inconsistent state, and worse, it meant
# THIS EXACT FIX couldn't even help the person hitting it, since the
# script that actually runs during an update is whatever's ALREADY on
# disk (the OLD version being updated FROM), not the new one being
# updated TO - a fix living only in the new zip's apply-update.ps1 can
# never influence the update it would have needed to fix. Now each
# folder is handled independently: one folder's failure is logged and
# skipped, everything else still gets updated, and the overall update
# is only reported as failed if something MORE than that specific
# per-folder hiccup went wrong.
$excludeFolders = @("data", "uploads", "uploads-airdrop", "backups", "node_modules")
$folderFailures = @()
try {
  Get-ChildItem -Path $stagingDir | ForEach-Object {
    if ($excludeFolders -notcontains $_.Name) {
      $itemName = $_.Name
      $dest = Join-Path $AppRoot $itemName
      $attempts = 0
      $done = $false
      while (-not $done -and $attempts -lt 3) {
        $attempts++
        try {
          if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
          Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
          $done = $true
        } catch {
          if ($attempts -lt 3) {
            Start-Sleep -Milliseconds 500 # transient lock (e.g. a process still shutting down) - give it a moment and retry
          } else {
            Write-Host "[WARNING] Could not replace '$itemName' after 3 tries (likely still in use by a running process) - left as-is for now: $_"
            $folderFailures += $itemName
          }
        }
      }
    }
  }
  if ($folderFailures.Count -eq 0) {
    Write-Host "[OK] Application files updated. Your data/uploads/backups were left untouched."
  } else {
    Write-Host "[WARNING] Everything updated EXCEPT: $($folderFailures -join ', ') - still on the previous version for now. This resolves itself automatically the next time you update (once whatever's holding it open has been closed)."
  }
} catch {
  Fail "Something went wrong copying the new files in. Your data backup is safe at $backupDir - restore from there if this folder looks broken. Error: $_"
}

# ---------- 3.5. Restore landing-page/data back into place (v1.1.4) ----------
# Completes the preserve-before/restore-after pair started in step 2.5
# above - the new landing-page folder just copied in by step 3 has
# whatever fresh seed data.json ships in this release's zip (if any);
# the user's REAL saved site list (preserved before the replace) takes
# priority and overwrites it here.
if ($hasExistingLandingPageData) {
  try {
    $newLandingPageDataDest = Join-Path $AppRoot "landing-page\data"
    if (Test-Path $newLandingPageDataDest) { Remove-Item $newLandingPageDataDest -Recurse -Force }
    Copy-Item -Path $landingPageDataPreserve -Destination $newLandingPageDataDest -Recurse -Force
    Write-Host "[OK] Restored landing-page/data - your saved Landing Page site list is preserved."
  } catch {
    Write-Host "[WARNING] Could not restore landing-page/data after the update. A copy should still be at '$landingPageDataPreserve' (temp, may get cleaned up eventually) and in the backup at $backupDir\landing-page-data - restore either manually into 'landing-page\data' if your saved site list looks empty after this update."
  }
}

# ---------- 3.6. Clean up v1.1.3's separate Landing Page auto-start (v1.1.4) ----------
# v1.1.3 shipped the Landing Page as a fully standalone program with its
# own install-landing.bat, which wrote its OWN Startup-folder .vbs
# (independent of tray.ps1) to auto-launch landing-page/server.js
# directly on login. v1.1.4 folds that lifecycle into tray.ps1 itself
# (Start-DexLandingPage/Stop-DexLandingPage) - leaving the old standalone
# Startup shortcut in place would mean TWO separate things trying to
# start the same port-80 process on every login, racing each other and
# meaning the tray's watchdog/enable-toggle can't actually control the
# one that's not started by starts through it. Safe no-op if this was
# never created (fresh installs, or anyone who's already been through
# this cleanup on a previous update to v1.1.4+).
try {
  $oldLandingStartup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\DexLabsLandingPage.vbs"
  if (Test-Path $oldLandingStartup) {
    Remove-Item $oldLandingStartup -Force
    Write-Host "[OK] Removed the old separate Landing Page auto-start entry from v1.1.3 (the tray now manages this itself)."
  }
} catch {
  Write-Host "[WARNING] Could not remove the old v1.1.3 Landing Page Startup shortcut - not critical (worst case, two things briefly race to start the same port on next login), but you can safely delete '$oldLandingStartup' by hand."
}

# ---------- 4. Install any new/changed dependencies ----------
Write-Host "Running npm install (needs internet)..."
Push-Location $AppRoot
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARNING] npm install exited with an error. The app files were updated, but some dependencies may be missing. Check the output above, then try running install.bat manually."
  } else {
    Write-Host "[OK] Dependencies installed."
  }
} finally {
  Pop-Location
}

# ---------- 5. Refresh the tray icon and Desktop/Start Menu shortcuts ----------
# This was a real gap fixed here: previously only install.bat created
# these, so anyone who updated via the tray's Update menu (or update.bat)
# instead of re-running install.bat never got them. Doing it here, as
# part of the shared update logic, means it happens every time regardless
# of which path was used to update.
try {
  $iconScript = Join-Path $AppRoot "generate-icon.ps1"
  if (Test-Path $iconScript) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $iconScript
  }
  $shortcutScript = Join-Path $AppRoot "create-shortcuts.ps1"
  if (Test-Path $shortcutScript) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $shortcutScript
  }
  Write-Host "[OK] Tray icon and shortcuts refreshed."
} catch {
  Write-Host "[WARNING] Could not refresh the icon/shortcuts - not critical, the app itself still works. Error: $_"
}

# ---------- 6. Clean up staging ----------
try { Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
try { if ($hasExistingLandingPageData) { Remove-Item $landingPageDataPreserve -Recurse -Force -ErrorAction SilentlyContinue } } catch {}

Write-Host "=== Update complete. Backup kept at: $backupDir ==="
# Only "landing-page" failing to replace is a KNOWN, self-resolving
# case (a still-running old-style Landing Page process holding its
# folder open - see the big comment on step 3 above) - everything that
# actually matters (tray.ps1, server.js, lib/, public/, package.json)
# still got updated. Report success so the person isn't shown a scary
# warning for something that fixes itself on its own next update. Any
# OTHER unexpected folder failure still gets flagged for real.
$unexpectedFailures = $folderFailures | Where-Object { $_ -ne "landing-page" }
if ($unexpectedFailures.Count -gt 0) {
  Write-Host "[WARNING] Some files could not be updated: $($unexpectedFailures -join ', ')"
  exit 1
}
exit 0
