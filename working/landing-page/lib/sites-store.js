// Landing Page's own tiny JSON-file "database" for the list of sites it
// shows. Deliberately a completely separate file/folder from DEX Labs'
// own data/ directory and every store in the main project (db.js,
// lib/*-store.js) - see landing-page/README.md for why this whole
// feature is a standalone system with its own server, its own port
// (80), and its own data, rather than a subsystem mounted inside DEX
// Labs itself. The short version: it needs to keep working (and stay
// reachable) even if the main DEX Labs server is stopped, crashed, or
// mid-update, since it's the front door people hit before they even
// know DEX Labs' own port.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'sites.json');

const MAX_SITES = 40; // generous - this is a home LAN site list, not a directory service

// One-time seed: pre-fill the list with an entry for DEX Labs itself,
// since it's the obvious first "website on this computer" almost
// everyone using this feature will already have running. Best-effort
// read of the main app's OWN data/config.json to get its real
// configured port (in case it was ever changed from the 3002 default
// via the tray's Settings menu) - read-only, wrapped in try/catch, and
// never touches that file. Falls back to the documented default of
// 3002 if it's missing/unreadable/mid-write, which is harmless: the
// user can always fix the port from this page's own Edit button.
function seedDexLabsEntry() {
  let port = 3002;
  try {
    const mainConfigPath = path.join(__dirname, '..', '..', 'data', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(mainConfigPath, 'utf-8'));
    if (cfg && Number.isInteger(cfg.port)) port = cfg.port;
  } catch (e) { /* DEX Labs' own config not there/readable yet - 3002 default is fine */ }
  return {
    id: 'dex-labs',
    name: 'DEX Labs',
    port,
    path: '/',
    note: 'Lesson Tracker, AirDrop, Daily Schedule, Clock, YouTube Downloader',
    addedAt: new Date().toISOString(),
  };
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ sites: [seedDexLabsEntry()] }, null, 2));
}

// Same tiny "read whole file / write whole file via temp+rename /
// serialize writes through one promise chain" pattern as every other
// store in this project (see lib/stopwatch-store.js) - simple, no
// extra dependencies, safe enough at this scale.
let writeQueue = Promise.resolve();

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    return { sites: [] };
  }
}

function write(data) {
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

function update(mutator) {
  // IMPORTANT: `mutator` must never throw. `writeQueue` is a single
  // long-lived promise chain (same pattern as every other store in
  // this project, e.g. lib/timers-store.js) - `.then()` on an already-
  // REJECTED promise skips straight to rejection without running the
  // callback. So if a mutator ever threw here, writeQueue itself would
  // become permanently rejected, and every future call to update() -
  // for any site, forever, until the server restarts - would silently
  // reject too. All validation (normalizeInput below, the MAX_SITES
  // cap) happens in create()/edit() BEFORE update() is ever called,
  // specifically so the mutator passed in is always just safe,
  // non-throwing array/object manipulation.
  writeQueue = writeQueue.then(() => {
    const data = read();
    const result = mutator(data);
    write(data);
    return result;
  });
  return writeQueue;
}

function genId() {
  return `site_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Shared validation for create() and edit() - throws a plain Error
// with a message that's safe to show directly to the user (server.js
// turns these into a 400 response as-is). Deliberately called BEFORE
// update()/its mutator ever runs (see the big comment on update()
// above) - never move a throw inside a mutator passed to update().
function normalizeInput(input) {
  const name = String((input && input.name) || '').trim();
  if (!name) throw new Error('Give this site a name.');
  if (name.length > 60) throw new Error('Name is too long (60 characters max).');

  const port = Number(input && input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be a number between 1 and 65535.');
  }

  let sitePath = String((input && input.path) || '/').trim() || '/';
  if (!sitePath.startsWith('/')) sitePath = `/${sitePath}`;
  if (sitePath.length > 200) throw new Error('Path is too long.');

  const note = String((input && input.note) || '').trim().slice(0, 200);

  return { name, port, path: sitePath, note };
}

async function listAll() {
  const data = read();
  return data.sites;
}

async function create(input) {
  // Validate and cap-check BEFORE touching the write queue - both can
  // throw, and update()'s mutator itself must never be the thing that
  // throws (see the warning above update()).
  const fields = normalizeInput(input);
  const current = read();
  if (current.sites.length >= MAX_SITES) {
    throw new Error(`You already have ${MAX_SITES} sites saved - remove one before adding another.`);
  }
  const entry = { id: genId(), addedAt: new Date().toISOString(), ...fields };
  return update((data) => {
    data.sites.push(entry);
    return entry;
  });
}

async function edit(id, input) {
  // Same reasoning - validate first, so update()'s mutator (below)
  // only ever does the safe, non-throwing part: finding the row (or
  // not) and assigning already-validated fields onto it.
  const fields = normalizeInput(input);
  return update((data) => {
    const existing = data.sites.find((s) => s.id === id);
    if (!existing) return null;
    Object.assign(existing, fields);
    return existing;
  });
}

async function remove(id) {
  return update((data) => {
    data.sites = data.sites.filter((s) => s.id !== id);
  });
}

module.exports = {
  MAX_SITES,
  listAll,
  create,
  edit,
  remove,
};
