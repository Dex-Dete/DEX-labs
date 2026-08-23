// Clipboard clips store - v1.5.0. The "AirCopy"/clipboard half of
// AirDrop: text pasted on a phone shows up on the PC for 30 minutes,
// newest first, copyable from the machine (and auto-copied to the
// machine's own clipboard whenever a new one arrives - see
// routes/airdrop.js's copyClipToPcClipboard()).
//
// Own data file (data/clips.json), same isolation pattern as every
// other store. A clip is deliberately tiny:
//   { id, text, source (e.g. "iPhone", free text from the sender),
//     createdAt, expiresAt }
//
// TTL is 30 minutes per the brief ("appear in DEX Labs for 30
// minutes") - shorter than files (1 hour) because text is meant to be
// copied off, not archived.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'clips.json');

const TTL_MS = 30 * 60 * 1000; // 30 minutes

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ clips: [] }, null, 2));

let writeQueue = Promise.resolve();

// Cache in memory - this process is the only writer, and every device
// on the WiFi polls the clips list every few seconds.
let cache = null;

function read() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!Array.isArray(data.clips)) data.clips = [];
    cache = data;
  } catch (e) {
    cache = { clips: [] };
  }
  return cache;
}

function write(data) {
  cache = data;
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
  return `clip_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Drop any expired clips. Safe to call often - no-op when nothing has
// expired. Wired into the same server interval that sweeps AirDrop
// files (see server.js).
function cleanupExpired() {
  return update((data) => {
    const now = Date.now();
    const expired = data.clips.filter((c) => c.expiresAt <= now);
    if (expired.length === 0) return { removed: 0 };
    data.clips = data.clips.filter((c) => c.expiresAt > now);
    return { removed: expired.length };
  });
}

async function listActive() {
  await cleanupExpired();
  const data = read();
  return data.clips
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first
}

async function getById(id) {
  await cleanupExpired();
  const data = read();
  return data.clips.find((c) => c.id === id) || null;
}

function addClip({ text, source }) {
  const now = Date.now();
  const clip = {
    id: genId(),
    text,
    source: (source || 'Phone').slice(0, 40),
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  return update((data) => {
    data.clips.push(clip);
    return clip;
  });
}

async function removeById(id) {
  const data = read();
  const clip = data.clips.find((c) => c.id === id);
  await update((d) => {
    d.clips = d.clips.filter((c) => c.id !== id);
  });
  return !!clip;
}

module.exports = {
  TTL_MS,
  listActive,
  getById,
  addClip,
  removeById,
  cleanupExpired,
};
