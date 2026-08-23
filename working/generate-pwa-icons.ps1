# Generates the installable-app (PWA) icons for DEX Labs - the DL
# monogram on the blue rounded square, matching tray-icon.ico and
# public/favicon.*. Outputs public/icons/icon-192.png,
# public/icons/icon-512.png and public/icons/apple-touch-icon.png (180).
# Chrome/Edge/Brave need >=192 and 512 for the "Install app" prompt;
# the 180 is for iPhone/iPad home screens.
Add-Type -AssemblyName System.Drawing

function New-DexPwaIcon {
  param([int]$Size, [string]$DestPath)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $radius = [int]($Size * 0.18)
  $rect = New-Object System.Drawing.Rectangle 0, 0, ($Size - 1), ($Size - 1)
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $gp.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $gp.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $gp.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $gp.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $gp.CloseFigure()
  $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 47, 102, 144))
  $g.FillPath($fill, $gp)

  $fontSize = [Math]::Round($Size * 0.41)
  $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rectF = [System.Drawing.RectangleF]::new($rect.X, $rect.Y, $rect.Width, $rect.Height)
  $g.DrawString("DL", $font, [System.Drawing.Brushes]::White, $rectF, $format)

  $g.Dispose()
  $bmp.Save($DestPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $DestPath"
}

$outDir = Join-Path $PSScriptRoot "public\icons"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
New-DexPwaIcon -Size 192 -DestPath (Join-Path $outDir "icon-192.png")
New-DexPwaIcon -Size 512 -DestPath (Join-Path $outDir "icon-512.png")
New-DexPwaIcon -Size 180 -DestPath (Join-Path $outDir "apple-touch-icon.png")