$ErrorActionPreference = "Stop"

Set-Location "C:\Users\ASUS\Documents\DEX-Labs-v1.1.5"

git add .

if (git diff --cached --quiet) {
    Write-Host "No changes to commit."
    exit
}

$time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

git commit -m "Auto Sync $time"
git pull --rebase origin main
git push origin main

Write-Host ""
Write-Host "DEX Labs synced successfully."
Pause