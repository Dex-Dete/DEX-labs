// Events store - v1.3.0. New tab inside the Clock subsystem (id
// 'timers') for tracking countdown-to events (exams, deadlines, etc.).
// Fully separate data file (data/events.json), same isolation pattern
// as every other store in this app - own file, own everything.
//
// Deliberately simple/flat: { id, name, targetDate (YYYY-MM-DD),
// createdAt }. No recurrence, no per-event settings - the brief only
// asks for a name + target date, seeded with one example
// (G.C.E. O/L Exam, 5 Dec 2026) plus the ability to add more from the
// UI. This also feeds Standby Mode's events section (see sbm.js) - both
// read from this same store via GET /api/events, so there's exactly one
// source of truth.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'events.json');

const SEED = {
  events: [
    { id: 'seed-gce-ol-2026', name: 'G.C.E. O/L Exam', targetDate: '2026-12-05', createdAt: Date.now() },
  ],
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(SEED, null, 2));

let writeQueue = Promise.resolve();

// v1.3.1 perf fix: cache in memory - this process is the only writer.
let cache = null;

function read() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!Array.isArray(data.events)) data.events = [];
    cache = data;
  } catch (e) {
    cache = { events: [] };
  }
  return cache;
}

function write(data) {
  cache = data;
  writeQueue = writeQueue.then(() => new Promise((resolve, reject) => {
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8', (err) => {
      if (err) return reject(err);
      fs.rename(tmpPath, DB_PATH, (err2) => (err2 ? reject(err2) : resolve()));
    });
  }));
  return writeQueue;
}

function list() {
  return read().events.slice().sort((a, b) => a.targetDate.localeCompare(b.targetDate));
}

async function add({ name, targetDate }) {
  const data = read();
  const event = {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    targetDate,
    createdAt: Date.now(),
  };
  data.events.push(event);
  await write(data);
  return event;
}

async function remove(id) {
  const data = read();
  const before = data.events.length;
  data.events = data.events.filter((e) => e.id !== id);
  if (data.events.length === before) return false;
  await write(data);
  return true;
}

// Events that haven't passed yet (target date today or later), soonest
// first - what both the Events tab and SBM/the load-once banner want.
function upcoming() {
  const todayStr = new Date().toISOString().slice(0, 10);
  return list().filter((e) => e.targetDate >= todayStr);
}

module.exports = { list, add, remove, upcoming };
