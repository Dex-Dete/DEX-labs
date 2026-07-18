// Stopwatch storage - the third menu inside the Clock subsystem
// (alongside Timer and Alarm, both in lib/timers-store.js). Kept as its
// own file/own data file for the same reason every other piece of state
// in this project gets its own store - easy to reason about, easy to
// wipe/reset independently - but it's mounted under the SAME router/
// SAME subsystem id ('timers', now labeled "Clock") as Timer/Alarm, not
// a separate subsystem. See routes/timers.js for the HTTP layer.
//
// Unlike Timer/Alarm, a stopwatch never needs a server-side tick loop or
// a beep - there's nothing to "expire" and nothing to alert about. Its
// elapsed time is derived purely from stored timestamps + wall-clock
// `now` whenever it's read (see elapsedMs() below), so it stays correct
// across server restarts with zero background work, and doesn't need to
// factor into GET /api/busy the way Timers/YouTube Downloader do (those
// guard actual in-flight work; a running stopwatch is just numbers).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'stopwatch.json');

const MAX_ACTIVE_STOPWATCHES = 10; // same cap as Timer/Alarm, for the same reason (sane UI, sane list size)

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ stopwatches: [] }, null, 2));

let writeQueue = Promise.resolve();

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    return { stopwatches: [] };
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
  return `sw_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Elapsed time = whatever was already banked (accumulatedMs, from
// previous run segments before the last pause) + however long the
// current run segment has been going, if it's running right now.
function elapsedMs(entry, now) {
  const live = entry.running ? Math.max(0, now - entry.startedAt) : 0;
  return entry.accumulatedMs + live;
}

async function listAll() {
  const data = read();
  return data.stopwatches;
}

async function countActive() {
  const data = read();
  return data.stopwatches.length;
}

async function create(label) {
  const now = Date.now();
  const entry = {
    id: genId(),
    label: (label || '').trim() || 'Stopwatch',
    createdAt: new Date(now).toISOString(),
    running: true,
    startedAt: now,
    accumulatedMs: 0,
    laps: [],
  };
  await update((data) => { data.stopwatches.push(entry); });
  return entry;
}

async function pause(id) {
  const now = Date.now();
  return update((data) => {
    const t = data.stopwatches.find((x) => x.id === id);
    if (!t) return null;
    if (t.running) {
      t.accumulatedMs = elapsedMs(t, now);
      t.running = false;
      t.startedAt = null;
    }
    return t;
  });
}

async function resume(id) {
  const now = Date.now();
  return update((data) => {
    const t = data.stopwatches.find((x) => x.id === id);
    if (!t) return null;
    if (!t.running) {
      t.running = true;
      t.startedAt = now;
    }
    return t;
  });
}

async function lap(id) {
  const now = Date.now();
  return update((data) => {
    const t = data.stopwatches.find((x) => x.id === id);
    if (!t) return null;
    t.laps.push({ id: genId(), ms: elapsedMs(t, now), at: new Date(now).toISOString() });
    // Keep the lap list from growing forever - 50 is generous for any
    // real use of this (a lap every few seconds for hours) and keeps
    // the JSON file/UI list sane.
    if (t.laps.length > 50) t.laps = t.laps.slice(t.laps.length - 50);
    return t;
  });
}

async function reset(id) {
  const now = Date.now();
  return update((data) => {
    const t = data.stopwatches.find((x) => x.id === id);
    if (!t) return null;
    t.accumulatedMs = 0;
    t.laps = [];
    t.startedAt = t.running ? now : null;
    return t;
  });
}

async function remove(id) {
  return update((data) => {
    data.stopwatches = data.stopwatches.filter((x) => x.id !== id);
  });
}

module.exports = {
  MAX_ACTIVE_STOPWATCHES,
  elapsedMs,
  listAll,
  countActive,
  create,
  pause,
  resume,
  lap,
  reset,
  remove,
};
