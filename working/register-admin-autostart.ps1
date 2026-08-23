# v1.3.0. Registers a proper Windows Scheduled Task so DEX Labs starts
# at boot with Administrator rights, replacing the permission-less
# Startup-folder fallback (DEXLABS.bat / DEX Labs.lnk) once you've
# explicitly asked for this - see the "Set Up Proper Auto-Start (Admin)"
# tray menu item, which is the ONLY thing that ever launches this
# script, always via `Start-Process -Verb RunAs` (same self-elevation
# idiom already used elsewhere in this project for the Landing Page
# firewall rule - a small, narrowly-scoped elevated action, launched
# only at your explicit request, rather than the whole tray silently
# trying to self-elevate).
#
# UNTESTED BY CLAUDE - this is Windows Scheduled Task / UAC territory
# that can't be exercised in a Linux sandbox. Please test this by hand:
# click the tray menu item, accept the UAC prompt, confirm
# `Get-ScheduledTask -TaskName DexLabsAutoStart` shows it registered,
# log out and back in and confirm DEX Labs starts (check Task Manager
# for node.exe/tray.ps1, or the tray icon appearing), and confirm the
# old "DEX Labs.lnk" Startup shortcut is gone afterwards.
#
# Design choice worth double-checking against what you actually want:
# this asks for Administrator ONCE, right now, to REGISTER the task
# (RunLevel Highest) - after that, the task runs elevated automatically
# on every login with NO further UAC prompt (that's what RunLevel
# Highest + a Scheduled Task trigger means - unlike a Startup-folder
# item, which can never run elevated no matter what). If what you
# actually wanted was a VISIBLE UAC prompt at every single login instead
# (more friction, but you'd see/approve elevation happening each time),
# that's a different, simpler mechanism (a Startup entry that itself
# calls Start-Process -Verb RunAs) - let me know if you'd rather have
# that instead.

$ErrorActionPreference = "Stop"
$AppRoot = $PSScriptRoot
$TaskName = "DexLabsAutoStart"
$VbsPath = Join-Path $AppRoot "run-hidden.vbs"

Add-Type -AssemblyName System.Windows.Forms

function Fail($msg) {
  Write-Host "[ERROR] $msg"
  [System.Windows.Forms.MessageBox]::Show($msg, "DEX Labs - Auto-Start Setup Failed", 0, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  exit 1
}

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail "This needs to run elevated (as Administrator) - if you're seeing this, something launched it without the UAC prompt going through correctly. Try the tray menu item again."
}

if (-not (Test-Path $VbsPath)) {
  Fail "run-hidden.vbs is missing from $AppRoot - the install looks incomplete. Try running install.bat first."
}

try {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "[OK] '$TaskName' is already registered - nothing to do."
  } else {
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$VbsPath`"" -WorkingDirectory $AppRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "[OK] Registered Scheduled Task '$TaskName' - DEX Labs will now start at login with Administrator rights, no further prompts."
  }

  # Now that the proper entry is in place, remove the permission-less
  # fallback so the two don't both fire on next login.
  $fallbackShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\DEX Labs.lnk"
  if (Test-Path $fallbackShortcut) {
    Remove-Item $fallbackShortcut -Force
    Write-Host "[OK] Removed the permission-less Startup-folder fallback (the Scheduled Task replaces it)."
  }

  [System.Windows.Forms.MessageBox]::Show("Proper auto-start is set up. DEX Labs will now start automatically (with Administrator rights) next time you log in.", "DEX Labs", 0, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
} catch {
  Fail "Could not register the Scheduled Task: $_"
}
