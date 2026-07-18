// Tiny, self-contained store for the AirDrop file-share feature.
// Deliberately kept separate from db.js / data/db.json (the Lesson
// Tracker database) - AirDrop is a different tool that happens to live
// on the same site/port, not a feature of Lesson Tracker.
const fs = require('fs');
const path = require('path');
const config = require('./config-store');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'airdrop.json');
const DEFAULT_FILES_DIR = path.join(__dirname, '..', 'uploads-airdrop');

const TTL_MS = 60 * 60 * 1000; // 1 hour

// v1.0.5: the session cap and save location are now user-configurable
// (Settings page / tray Settings menu) instead of hardcoded - see
// config-store.js's airdropMaxUsageGB / airdropSaveLocation. Both are
// read live (not cached) so a settings change takes effect immediately,
// no restart needed. Falls back to the old defaults (30GB, the project's
// own uploads-airdrop/ folder) if nothing has been configured yet.
function getCapBytes() {
  const gb = Number(config.get().airdropMaxUsageGB);
  const safeGb = Number.isFinite(gb) && gb > 0 ? gb : 30;
  return Math.round(safeGb * 1024 * 1024 * 1024);
}

function getFilesDir() {
  const custom = (config.get().airdropSaveLocation || '').trim();
  const dir = custom || DEFAULT_FILES_DIR;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // Custom location isn't writable/valid (e.g. removable drive that's
    // no longer plugged in) - fall back to the default rather than
    // crashing AirDrop entirely.
    console.error(`[airdrop] Could not use configured save location "${dir}", falling back to default:`, e.message);
    if (!fs.existsSync(DEFAULT_FILES_DIR)) fs.mkdirSync(DEFAULT_FILES_DIR, { recursive: true });
    return DEFAULT_FILES_DIR;
  }
  return dir;
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DEFAULT_FILES_DIR)) fs.mkdirSync(DEFAULT_FILES_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ files: [] }, null, 2));

let writeQueue = Promise.resolve();

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    return { files: [] };
  }
}

function write(data) {
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

function update(mutator) {
  writeQueue = writeQueue.then(() => {
    const data = read();
    const result = mutator(data);
    write(data);
    return result;
  });
  return writeQueue;
}

function genId() {
  return `drop_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function deleteFileFromDisk(storedName) {
  if (!storedName) return;
  const filePath = path.join(getFilesDir(), storedName);
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    // already gone / never existed - fine
  }
}

// Remove any expired entries (metadata + the underlying file on disk).
// Safe to call often - it's a no-op when nothing has expired.
function cleanupExpired() {
  return update((data) => {
    const now = Date.now();
    const expired = data.files.filter((f) => f.expiresAt <= now);
    if (expired.length === 0) return { removed: 0 };
    for (const f of expired) deleteFileFromDisk(f.storedName);
    data.files = data.files.filter((f) => f.expiresAt > now);
    return { removed: expired.length };
  });
}

async function listActive() {
  await cleanupExpired();
  const data = read();
  return data.files
    .slice()
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)); // newest first
}

async function getById(id) {
  await cleanupExpired();
  const data = read();
  return data.files.find((f) => f.id === id) || null;
}

async function getTotalActiveBytes() {
  const files = await listActive();
  return files.reduce((sum, f) => sum + (f.size || 0), 0);
}

function addFiles(entries) {
  return update((data) => {
    data.files.push(...entries);
    return entries;
  });
}

async function removeById(id) {
  const data = read();
  const file = data.files.find((f) => f.id === id);
  if (file) deleteFileFromDisk(file.storedName);
  await update((d) => {
    d.files = d.files.filter((f) => f.id !== id);
  });
  return !!file;
}

module.exports = {
  TTL_MS,
  getCapBytes,
  getFilesDir,
  genId,
  addFiles,
  listActive,
  getById,
  removeById,
  cleanupExpired,
  getTotalActiveBytes,
};
