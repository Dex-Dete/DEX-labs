# Generates tray-icon.ico if it doesn't already exist. Shared by tray.ps1
# (needs it for the tray icon itself) and install.bat (needs it to exist
# BEFORE creating Desktop/Start Menu shortcuts, so those shortcuts show
# the right icon instead of a generic default). Kept in one file so the
# drawing code can't drift between two copies.
Add-Type -AssemblyName System.Drawing

function New-DexTrayIcon {
  param([string]$Path)
  if (Test-Path $Path) { return }
  try {
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(255, 47, 102, 144))
    $font = New-Object System.Drawing.Font("Arial", 13, [System.Drawing.FontStyle]::Bold)
    $brush = [System.Drawing.Brushes]::White
    $g.DrawString("DL", $font, $brush, 2, 7)
    $g.Dispose()
    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Create)
    $icon.Save($fs)
    $fs.Close()
    $bmp.Dispose()
  } catch {
    Write-Host "Could not generate tray icon: $_"
  }
}

# Allow this to be run standalone (e.g. from install.bat) as well as
# dot-sourced from tray.ps1 for just the function definition.
if ($MyInvocation.InvocationName -ne '.') {
  $iconPath = Join-Path $PSScriptRoot "tray-icon.ico"
  New-DexTrayIcon -Path $iconPath
}
