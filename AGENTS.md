# Release process (for AI sessions) — MANDATORY, TOP PRIORITY

Every time a change is made to this project — whether a bug fix, new feature, or
anything else — follow this process automatically, without being asked. This is
the #1 priority. Do the feature work first, then immediately run the full
release process below.

## 1. Bump the version
Update `version` in both `package.json` and `package-lock.json`.

## 2. Document the changes
- Add a `# DEX Labs vX.Y.Z - Changes` section to the TOP of `CHANGES.md` with a write-up.
- Add a `## vX.Y.Z (for future sessions)` section to `PROJECT_BRIEFING.md` (right after the newest section at the top) with a short summary + rules for future work.

## 3. Commit, tag, and push
```powershell
git add -A
git commit -m "Bump to vX.Y.Z and update changelog"
git tag vX.Y.Z
git push origin main --tags
```

## 4. Create the release zip
Zip the project root CONTENTS (not the folder itself) so `package.json` is at zip root. Use the naming format `DEX-Labs-vX_Y_Z.zip` (underscores, capital DEX). Exclude user data dirs but include empty placeholder dirs:
```powershell
$items = Get-ChildItem -Path . -Exclude '.git','node_modules','backups','data','uploads','uploads-airdrop','downloads-youtube','logs.txt'
$tempDir = "$env:TEMP\dex-labs-vX_Y_Z"
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
foreach ($item in $items) { Copy-Item -Recurse -Path $item.FullName -Destination "$tempDir\$($item.Name)" }
# Create empty placeholder dirs (matching previous release format)
New-Item -ItemType Directory -Path "$tempDir\uploads" -Force | Out-Null
New-Item -ItemType Directory -Path "$tempDir\uploads-airdrop" -Force | Out-Null
New-Item -ItemType Directory -Path "$tempDir\downloads-youtube" -Force | Out-Null
Compress-Archive -Path "$tempDir\*" -DestinationPath "DEX-Labs-vX_Y_Z.zip" -Force
Remove-Item -Recurse -Force $tempDir
```

## 5. Create GitHub release
Get the token from git credential manager and use the GitHub API:
```powershell
"protocol=https`nhost=github.com`n" | git credential fill
```
Then create the release via API and upload the zip as an asset. Use content-type `application/x-zip-compressed`:
```powershell
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$body = @{ tag_name = "vX.Y.Z"; name = "DEX Labs vX.Y.Z"; body = "<release notes from CHANGES.md>" } | ConvertTo-Json
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/Dex-Dete/DEX-labs/releases" -Method Post -Headers $headers -Body $body -ContentType "application/json"
$uploadUrl = "https://uploads.github.com/repos/Dex-Dete/DEX-labs/releases/$($release.id)/assets?name=DEX-Labs-vX_Y_Z.zip"
$headers.ContentType = "application/x-zip-compressed"
Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $headers -InFile "DEX-Labs-vX_Y_Z.zip" -ContentType "application/x-zip-compressed"
```

## 6. Clean up
Delete the local zip file after uploading.
