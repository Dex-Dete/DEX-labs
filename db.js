// Tiny JSON-file database. No native/compiled modules involved on purpose -
// this keeps `npm install` fast and dependable on an older Windows machine
// that may not have build tools installed.
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

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
  writeQueue = writeQueue.then(() => {
    const data = read();
    const result = mutator(data);
    write(data);
    return result;
  });
  return writeQueue;
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
