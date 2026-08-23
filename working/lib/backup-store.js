// v1.2.0: backup subsystem. Own file/data, same pattern as
// lib/config-store.js (flat JSON, tmp+rename writes) - data/backup.json
// lives in data/ so it survives updates exactly like every other data
// file (apply-update.ps1 never touches data/).
//
// Two independent backup targets, both driven from this one file:
//
//   Disk  - copies data/*.json to a folder the person picks somewhere
//           ELSE on their machine (never inside the DEX Labs folder
//           itself - the whole point is surviving a "delete the DEX
//           Labs folder and reinstall" scenario, which copying inside
//           that same folder wouldn't survive). Runs every 3 minutes
//           (see server.js). Mandatory - routes/settings.js's
//           setupComplete gate won't let the site load until a path is
//           chosen, same "forced first-run setup" mechanism v1.0.5
//           already uses for AirDrop's settings.
//
//   Drive - optional. Standard OAuth2 "Desktop app" loopback flow - the
//           person creates their own free Google Cloud OAuth client
//           (Anthropic/this app can't provision one on their behalf,
//           since every self-hosted DEX Labs instance runs on its own
//           http://localhost:<port>, and Google's "Desktop app" client
//           type is exactly the one built for that: it accepts ANY
//           localhost port as a redirect URI with nothing to
//           pre-register, unlike the "Web application" type). Uses ONLY
//           the drive.file scope - this app can see/manage only the
//           files IT creates, never the rest of the person's Drive.
//           Runs every 30 minutes (see server.js).
//
// Restore-from-Drive on a fresh install / reinstall-after-removal is in
// maybeRestoreFromDrive() - see server.js for exactly when/why it's
// called (has to run before any other store gets a chance to
// auto-create its own default data/*.json file, or "was data/ empty"
// would never be observably true again after the very first boot).
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(APP_ROOT, 'data');
const BACKUP_CONFIG_PATH = path.join(DATA_DIR, 'backup.json');
const BACKUP_SUBFOLDER_NAME = 'DexLabsBackup'; // created inside whatever folder the person picks
const DRIVE_BACKUP_FOLDER_NAME = 'DEX Labs Backups'; // created inside their Drive root

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

const DEFAULTS = {
  diskBackupPath: '',
  diskConfiguredAt: null,
  diskLastRunAt: null,
  diskLastOkAt: null,
  diskLastError: null,
  driveClientId: '',
  driveClientSecret: '',
  driveTokens: null, // { accessToken, refreshToken, expiresAt }
  driveFolderId: '',
  driveLinked: false,
  driveLastRunAt: null,
  driveLastOkAt: null,
  driveLastError: null,
  driveLastRestoreAt: null,
  driveLastRestoreResult: null,
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// The one deliberate exception to "back up every data/*.json file":
// backup.json itself. It holds the Google OAuth client secret and
// refresh token - uploading it INTO the very Drive folder that token
// authenticates to is circular, and copying it into the disk backup
// folder means anything that syncs that folder elsewhere (Dropbox,
// OneDrive, another cloud drive pointed at the same folder) would carry
// the token along with it for no benefit. Everything else in data/ -
// the actual study/schedule/timers/airdrop data this feature exists to
// protect - is backed up and restored normally.
const BACKUP_CONFIG_FILENAME = path.basename(BACKUP_CONFIG_PATH);
function backableDataFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json') && f !== BACKUP_CONFIG_FILENAME);
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(BACKUP_CONFIG_PATH, 'utf-8'));
    return { ...DEFAULTS, ...data };
  } catch (e) {
    return { ...DEFAULTS };
  }
}
function write(partial) {
  const next = { ...read(), ...partial };
  const tmp = BACKUP_CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, BACKUP_CONFIG_PATH);
  return next;
}

// Sanitized view for the frontend - NEVER include driveClientSecret or
// the raw tokens. clientId itself isn't secret (it's fine to echo back
// so the person can confirm what they saved) but the secret is
// write-only from here on out, same spirit as how a password field
// never redisplays what was typed.
function getStatus() {
  const cfg = read();
  return {
    disk: {
      configured: !!cfg.diskBackupPath,
      path: cfg.diskBackupPath || '',
      lastRunAt: cfg.diskLastRunAt,
      lastOkAt: cfg.diskLastOkAt,
      lastError: cfg.diskLastError,
    },
    drive: {
      credentialsSet: !!(cfg.driveClientId && cfg.driveClientSecret),
      clientId: cfg.driveClientId || '',
      linked: !!cfg.driveLinked,
      lastRunAt: cfg.driveLastRunAt,
      lastOkAt: cfg.driveLastOkAt,
      lastError: cfg.driveLastError,
      lastRestoreAt: cfg.driveLastRestoreAt,
      lastRestoreResult: cfg.driveLastRestoreResult,
    },
  };
}

// ---------------- Disk backup ----------------

function setDiskPath(rawPath) {
  const clean = (rawPath || '').trim();
  if (!clean) throw new Error('Enter a folder path.');
  const resolved = path.resolve(clean);
  const resolvedRoot = path.resolve(APP_ROOT);
  // Must be OUTSIDE the DEX Labs folder itself - a backup that lives
  // inside the very folder a reinstall would delete defeats the point.
  if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Pick a folder outside the DEX Labs app folder - somewhere else on your PC. (Backing up inside DEX Labs' own folder wouldn't survive a reinstall, which is the main reason this exists.)");
  }
  try {
    if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch (e) {
    throw new Error(`That folder isn't usable: ${e.message}`);
  }
  write({ diskBackupPath: resolved, diskConfiguredAt: Date.now() });
  return getStatus();
}

// Copies every data/*.json file into <diskBackupPath>/DexLabsBackup/,
// one at a time with a tmp+rename per file (same safety pattern every
// store's own write() already uses) so an interruption mid-copy can
// never leave a half-written, corrupt backup file behind - worst case
// is that one file's backup is simply one cycle stale.
async function runDiskBackup() {
  const cfg = read();
  if (!cfg.diskBackupPath) return { ok: false, skipped: true, reason: 'not configured' };
  const destDir = path.join(cfg.diskBackupPath, BACKUP_SUBFOLDER_NAME);
  try {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const files = backableDataFiles();
    for (const f of files) {
      const src = path.join(DATA_DIR, f);
      const destTmp = path.join(destDir, `${f}.tmp`);
      const dest = path.join(destDir, f);
      fs.copyFileSync(src, destTmp);
      fs.renameSync(destTmp, dest);
    }
    write({ diskLastRunAt: Date.now(), diskLastOkAt: Date.now(), diskLastError: null });
    return { ok: true, filesCopied: files.length };
  } catch (e) {
    write({ diskLastRunAt: Date.now(), diskLastError: e.message });
    return { ok: false, error: e.message };
  }
}

// ---------------- Google Drive backup ----------------

function setDriveCredentials(clientId, clientSecret) {
  const id = (clientId || '').trim();
  const secret = (clientSecret || '').trim();
  if (!id || !secret) throw new Error('Enter both the Client ID and Client Secret.');
  write({ driveClientId: id, driveClientSecret: secret });
  return getStatus();
}

function getAuthUrl(redirectUri) {
  const cfg = read();
  if (!cfg.driveClientId) throw new Error('Save your Google OAuth Client ID/Secret first.');
  const params = new URLSearchParams({
    client_id: cfg.driveClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent', // forces Google to actually hand back a refresh_token every time, not just on first-ever consent
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code, redirectUri) {
  const cfg = read();
  const body = new URLSearchParams({
    code,
    client_id: cfg.driveClientId,
    client_secret: cfg.driveClientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || 'Google rejected the authorization code.');
  const tokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000 - 60000, // 60s safety margin
  };
  if (!tokens.refreshToken) {
    throw new Error("Google didn't return a long-lived token - open https://myaccount.google.com/permissions, remove any previous DEX Labs access, then try connecting again.");
  }
  write({ driveTokens: tokens, driveLinked: true, driveLastError: null });
  await ensureBackupFolder();
  return getStatus();
}

async function ensureFreshAccessToken() {
  const cfg = read();
  if (!cfg.driveLinked || !cfg.driveTokens) throw new Error('Google Drive is not linked.');
  if (cfg.driveTokens.expiresAt > Date.now()) return cfg.driveTokens.accessToken;
  const body = new URLSearchParams({
    client_id: cfg.driveClientId,
    client_secret: cfg.driveClientSecret,
    refresh_token: cfg.driveTokens.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) {
    // A revoked/expired refresh token means Drive backup is effectively
    // disconnected even though driveLinked was still true a moment ago -
    // surface that plainly rather than quietly failing forever every 30
    // minutes with no visible explanation.
    write({ driveLinked: false, driveLastError: 'Google Drive access expired or was revoked - reconnect from Settings.' });
    throw new Error('Google Drive access expired or was revoked - reconnect from Settings.');
  }
  const tokens = {
    accessToken: json.access_token,
    refreshToken: cfg.driveTokens.refreshToken, // a refresh grant doesn't hand back a new refresh token
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000 - 60000,
  };
  write({ driveTokens: tokens });
  return tokens.accessToken;
}

async function ensureBackupFolder() {
  const cfg = read();
  if (cfg.driveFolderId) return cfg.driveFolderId;
  const token = await ensureFreshAccessToken();
  const q = encodeURIComponent(`name='${DRIVE_BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const listRes = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listJson = await listRes.json();
  if (!listRes.ok) throw new Error((listJson.error && listJson.error.message) || 'Could not search Google Drive.');
  if (listJson.files && listJson.files.length > 0) {
    write({ driveFolderId: listJson.files[0].id });
    return listJson.files[0].id;
  }
  const createRes = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_BACKUP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok) throw new Error((createJson.error && createJson.error.message) || 'Could not create the Drive backup folder.');
  write({ driveFolderId: createJson.id });
  return createJson.id;
}

async function findDriveFileByName(token, folderId, name) {
  const q = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
  const res = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json.error && json.error.message) || 'Google Drive lookup failed.');
  return (json.files && json.files[0]) || null;
}

// Overwrites the file's content if a file with this name already exists
// in the backup folder, otherwise creates it. Uses Drive API v3's
// "multipart" upload shape for creation (metadata + content in one
// request) and a plain media PATCH for updates (the name/parent don't
// need to change on an update, so no metadata part needed there).
async function uploadDriveFile(token, folderId, name, content) {
  const existing = await findDriveFileByName(token, folderId, name);
  if (existing) {
    const res = await fetch(`${DRIVE_UPLOAD_API}/files/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: content,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error((json.error && json.error.message) || `Could not update ${name} on Google Drive.`);
    }
    return { id: existing.id, created: false };
  }
  const boundary = `dexlabsbackup${Math.random().toString(16).slice(2)}`;
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json.error && json.error.message) || `Could not upload ${name} to Google Drive.`);
  return { id: json.id, created: true };
}

async function runDriveBackup() {
  const cfg = read();
  if (!cfg.driveLinked) return { ok: false, skipped: true, reason: 'not linked' };
  try {
    const token = await ensureFreshAccessToken();
    const folderId = await ensureBackupFolder();
    const files = backableDataFiles();
    let count = 0;
    for (const f of files) {
      const content = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
      await uploadDriveFile(token, folderId, f, content);
      count++;
    }
    write({ driveLastRunAt: Date.now(), driveLastOkAt: Date.now(), driveLastError: null });
    return { ok: true, filesUploaded: count };
  } catch (e) {
    write({ driveLastRunAt: Date.now(), driveLastError: e.message });
    return { ok: false, error: e.message };
  }
}

// Called once at server startup (see server.js) with whether data/ had
// zero *.json files in it at the very moment the process started, BEFORE
// any other store had a chance to auto-create its own default file.
// That's what "fresh install, or DEX Labs was removed and reinstalled"
// actually looks like on disk. If local data already exists, this is a
// deliberate no-op - restoring would mean overwriting (or living
// alongside, confusingly) real, current data with a copy that's at best
// 30 minutes stale. The per-file existence re-check below is a second,
// belt-and-suspenders layer of the same rule: never overwrite a file
// that's already there, full stop, no matter how this function got
// called.
async function maybeRestoreFromDrive(dataDirWasEmptyAtBoot) {
  const cfg = read();
  if (!cfg.driveLinked) return { ok: false, skipped: true, reason: 'Drive not linked' };
  if (!dataDirWasEmptyAtBoot) {
    write({ driveLastRestoreAt: Date.now(), driveLastRestoreResult: 'skipped - local data already present' });
    return { ok: false, skipped: true, reason: 'local data already present' };
  }
  try {
    const token = await ensureFreshAccessToken();
    const folderId = await ensureBackupFolder();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const listRes = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listJson = await listRes.json();
    if (!listRes.ok) throw new Error((listJson.error && listJson.error.message) || 'Could not list Drive backup files.');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let restored = 0;
    for (const file of (listJson.files || [])) {
      if (!file.name.endsWith('.json') || file.name === BACKUP_CONFIG_FILENAME) continue;
      const destPath = path.join(DATA_DIR, file.name);
      if (fs.existsSync(destPath)) continue; // never overwrite something already there
      const dlRes = await fetch(`${DRIVE_API}/files/${file.id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!dlRes.ok) continue; // best-effort per file - one bad file shouldn't abort the rest
      const text = await dlRes.text();
      const tmp = `${destPath}.tmp`;
      fs.writeFileSync(tmp, text, 'utf-8');
      fs.renameSync(tmp, destPath);
      restored++;
    }
    write({ driveLastRestoreAt: Date.now(), driveLastRestoreResult: `restored ${restored} file(s)` });
    return { ok: true, filesRestored: restored };
  } catch (e) {
    write({ driveLastRestoreAt: Date.now(), driveLastRestoreResult: `failed: ${e.message}` });
    return { ok: false, error: e.message };
  }
}

async function disconnectDrive() {
  const cfg = read();
  if (cfg.driveTokens && cfg.driveTokens.accessToken) {
    try {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(cfg.driveTokens.accessToken)}`, { method: 'POST' });
    } catch (e) { /* best effort - clear our own state regardless of whether Google's revoke call succeeded */ }
  }
  write({ driveTokens: null, driveLinked: false, driveFolderId: '', driveLastError: null });
  return getStatus();
}

// Used by the manual "Back up now" button and (v1.2.0 system update ask)
// the pre-update hook in tray.ps1 - runs both targets, Drive only if
// actually linked. Never throws - both underlying functions already
// catch their own errors and report them in the returned object instead.
async function runNow() {
  const disk = await runDiskBackup();
  const cfg = read();
  const drive = cfg.driveLinked ? await runDriveBackup() : { ok: false, skipped: true, reason: 'not linked' };
  return { disk, drive };
}

module.exports = {
  getStatus,
  setDiskPath,
  runDiskBackup,
  setDriveCredentials,
  getAuthUrl,
  exchangeCodeForTokens,
  runDriveBackup,
  disconnectDrive,
  maybeRestoreFromDrive,
  runNow,
};
