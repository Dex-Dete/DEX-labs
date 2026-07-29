// v1.2.0: backup subsystem routes - disk backup config/run, Google Drive
// OAuth link/run/disconnect, and a combined "run both now" used by both
// the manual Settings-page button and tray.ps1's pre-update hook (see
// apply-update.ps1/tray.ps1 - the update flow calls POST /run-now while
// the server is still up and can still reach Drive, BEFORE stopping it).
const express = require('express');
const { execFile } = require('child_process');
const store = require('../lib/backup-store');

const router = express.Router();

function handleError(res, err, fallbackStatus = 400) {
  res.status(fallbackStatus).json({ error: (err && err.message) || 'Something went wrong' });
}

router.get('/status', (req, res) => {
  res.json(store.getStatus());
});

// ---------------- Disk backup ----------------

router.put('/disk-path', async (req, res) => {
  try {
    store.setDiskPath(req.body.path);
    // Run one immediately so Settings shows a real "last backed up"
    // result right away instead of the person having to wait up to 3
    // minutes to find out whether the folder they picked actually works.
    await store.runDiskBackup();
    res.json(store.getStatus());
  } catch (e) { handleError(res, e); }
});

router.post('/disk/run-now', async (req, res) => {
  try {
    const result = await store.runDiskBackup();
    res.json(result);
  } catch (e) { handleError(res, e, 500); }
});

// Opens a native Windows folder-browser dialog (same
// System.Windows.Forms approach tray.ps1 already uses for its own
// OpenFileDialog) so picking a backup folder doesn't require typing an
// exact path. Windows-only by nature (spawns powershell.exe) - if that
// fails for any reason (not on Windows, PowerShell unavailable, dialog
// cancelled), the frontend just falls back to the plain text field,
// nothing breaks.
router.post('/disk/browse', (req, res) => {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$f.Description = "Choose a DEX Labs backup folder - pick somewhere OTHER than the DEX Labs app folder"',
    '$f.ShowNewFolderButton = $true',
    'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }',
  ].join('; ');
  execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 120000 }, (err, stdout) => {
    if (err) {
      return res.status(500).json({ error: 'Could not open a folder picker on this device - type the path in below instead.' });
    }
    const picked = (stdout || '').trim();
    if (!picked) return res.status(400).json({ error: 'No folder was selected.' });
    res.json({ path: picked });
  });
});

// ---------------- Google Drive backup ----------------

router.put('/drive/credentials', (req, res) => {
  try {
    res.json(store.setDriveCredentials(req.body.clientId, req.body.clientSecret));
  } catch (e) { handleError(res, e); }
});

function callbackRedirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/backup/drive/oauth-callback`;
}

router.get('/drive/auth-url', (req, res) => {
  try {
    res.json({ url: store.getAuthUrl(callbackRedirectUri(req)) });
  } catch (e) { handleError(res, e); }
});

function oauthResultPage(ok, message) {
  const safe = String(message).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DEX Labs - Google Drive</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #f4f1ea; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { background: #fff; padding: 28px 32px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.12); max-width: 420px; text-align: center; }
  h1 { font-size: 1.15rem; margin: 0 0 12px; }
  a { color: #4b3f8f; }
</style></head>
<body><div class="box">
  <h1>${ok ? '✅ Google Drive connected' : '⚠️ Could not connect Google Drive'}</h1>
  <p>${safe}</p>
  <p><a href="/#/settings">Return to DEX Labs</a></p>
</div>
<script>setTimeout(() => { try { window.close(); } catch (e) {} }, 5000);</script>
</body></html>`;
}

// Google redirects the browser here directly after consent - this is a
// page navigation, not an API call the frontend fetch()es, so it
// responds with HTML rather than JSON.
router.get('/drive/oauth-callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send(oauthResultPage(false, `Google reported: ${error}`));
  if (!code) return res.send(oauthResultPage(false, 'No authorization code was returned.'));
  try {
    await store.exchangeCodeForTokens(code, callbackRedirectUri(req));
    res.send(oauthResultPage(true, 'You can close this tab and go back to DEX Labs.'));
  } catch (e) {
    res.send(oauthResultPage(false, e.message));
  }
});

router.post('/drive/run-now', async (req, res) => {
  try {
    const result = await store.runDriveBackup();
    res.json(result);
  } catch (e) { handleError(res, e, 500); }
});

router.post('/drive/disconnect', async (req, res) => {
  try {
    res.json(await store.disconnectDrive());
  } catch (e) { handleError(res, e, 500); }
});

// ---------------- Combined ----------------

// Manual "Back up now" button (both targets), and (v1.2.0 system update
// ask) tray.ps1 calls this right before every update, while the server
// is still up.
router.post('/run-now', async (req, res) => {
  try {
    res.json(await store.runNow());
  } catch (e) { handleError(res, e, 500); }
});

module.exports = router;
