# Release process (for AI sessions)

Every time a change is made to this project, follow this process:

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
Zip the project root CONTENTS (not the folder itself) so `package.json` is at zip root:
```powershell
$items = Get-ChildItem -Path . -Exclude '.git','node_modules','backups','logs.txt'
$tempDir = "$env:TEMP\dex-labs-vX.Y.Z"
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
foreach ($item in $items) { Copy-Item -Recurse -Path $item.FullName -Destination "$tempDir\$($item.Name)" }
Compress-Archive -Path "$tempDir\*" -DestinationPath "dex-labs-vX.Y.Z.zip" -Force
Remove-Item -Recurse -Force $tempDir
```

## 5. Create GitHub release
Get the token from git credential manager and use the GitHub API:
```powershell
"protocol=https`nhost=github.com`n" | git credential fill
```
Then create the release via API and upload the zip as an asset.

## 6. Clean up
Delete the local zip file after uploading.
