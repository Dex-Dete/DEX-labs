// Tiny JSON-file database. No native/compiled modules involved on purpose -
// this keeps `npm install` fast and dependable on an older Windows machine
// that may not have build tools installed.
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

// v1.2.0 fix: every OTHER store in this project (config-store.js,
// study-store.js, etc.) auto-creates its own default data file the
// moment it's required, if that file doesn't exist yet - this is the
// one exception that never had that guard, so a genuinely fresh
// install (an empty/missing data/ folder) 500'd on the very first
// Lesson Tracker request (`data.subjects` doesn't exist to read/loop
// over). Found while testing v1.2.0's fresh-install/restore-from-Drive
// path, which made "does a truly empty data/ folder work correctly"
// something worth actually checking end to end for the first time.
// Not something that touches the read/write/update logic below at all -
// purely "make sure the file exists with a sane empty shape before
// anything tries to read it."
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ subjects: [] }, null, 2), 'utf-8');

let writeQueue = Promise.resolve();

function read() {
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

function write(data) {
  // Write to a temp file then rename, so a crash mid-write can never
  // leave db.json corrupted/half-written.
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

// Serializes all read-modify-write operations so two near-simultaneous
// requests can't clobber each other.
function update(mutator) {
  const result = writeQueue.then(() => {
    const data = read();
    const result = mutator(data);
    write(data);
    return result;
  });
  writeQueue = result.catch(() => {});
  return result;
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(name) {
  return name
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || genId('subj');
}

module.exports = { read, write, update, genId, slugify };
