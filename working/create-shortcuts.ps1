# Creates Desktop + Start Menu shortcuts pointing at run-hidden.vbs (the
# same hidden-launch entrypoint used by auto-start). Kept as its own
# proper .ps1 file rather than an inline batch-escaped one-liner in
# install.bat - PowerShell string escaping and cmd.exe string escaping
# don't mix well, and this is much easier to get right (and read) as a
# real script file.
$AppRoot = $PSScriptRoot
$targetPath = Join-Path $AppRoot "run-hidden.vbs"
$iconPath = Join-Path $AppRoot "tray-icon.ico"

$destinations = @(
  (Join-Path $env:USERPROFILE "Desktop\DEX Labs.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\DEX Labs.lnk")
)

$wshShell = New-Object -ComObject WScript.Shell
foreach ($dest in $destinations) {
  try {
    $shortcut = $wshShell.CreateShortcut($dest)
    $shortcut.TargetPath = $targetPath
    $shortcut.WorkingDirectory = $AppRoot
    if (Test-Path $iconPath) { $shortcut.IconLocation = $iconPath }
    $shortcut.Description = "DEX Labs"
    $shortcut.Save()
    Write-Host "[OK] Shortcut created: $dest"
  } catch {
    Write-Host "[WARN] Could not create shortcut at $dest - $_"
  }
}
