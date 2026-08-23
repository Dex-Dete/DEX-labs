// To-Do list store - v1.4.0. Fully independent subsystem (own file, own
// data file data/todos.json, no cross-references), same isolation
// pattern as lib/events-store.js / lib/study-store.js.
//
// What lives in data/todos.json:
//   todos - the list. Each item:
//     id        - stable unique id
//     text      - the thing to do
//     createdAt - epoch ms when it was added
//     dueDate   - YYYY-MM-DD the task is scheduled for, or null (no date)
//     done      - bool: ticked off or not
//     doneAt    - YYYY-MM-DD (LOCAL date) the task was ticked off, or
//                 null. The Calendar tab uses this to show "what I did
//                 that day", so it must be the local calendar date, not
//                 UTC - same lesson as lib/study-store.js's localDateStr
//                 (see its v1.2.0 comment).
//
// Adding and deleting is deliberately dead simple (the brief demanded
// "make sure adding and deleting is easy"): one POST to add, one DELETE
// to remove, one PATCH to tick/un-tick (or edit the text / re-schedule).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'todos.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ todos: [] }, null, 2));

let writeQueue = Promise.resolve();

// v1.3.1-style perf fix: cache in memory - this process is the only
// writer, and the Calendar tab/Standby Mode read this list frequently.
let cache = null;

function read() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!Array.isArray(data.todos)) data.todos = [];
    cache = data;
  } catch (e) {
    cache = { todos: [] };
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

// Local (server-machine) calendar date as YYYY-MM-DD - mirrors
// lib/study-store.js's localDateStr() exactly so "today" never disagrees
// between the to-do store and the study heatmap.
function localDateStr(d) {
  const date = d || new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Full list, ready for display: pending first (soonest due date first,
// undated last), then done ones (most recently completed first).
function list() {
  const todos = read().todos.slice();
  const pending = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  pending.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return b.createdAt - a.createdAt;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  done.sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
  return pending.concat(done);
}

// Pending (not ticked) todos only - what "today's to-do list" and the
// Calendar tab's scheduled section want. Sorted by due date first.
function listPending() {
  return list().filter((t) => !t.done);
}

async function add({ text, dueDate }) {
  const data = read();
  const todo = {
    id: `todo-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    text,
    dueDate: dueDate || null,
    done: false,
    doneAt: null,
    createdAt: Date.now(),
  };
  data.todos.push(todo);
  await write(data);
  return todo;
}

async function update(id, patch) {
  const data = read();
  const todo = data.todos.find((t) => t.id === id);
  if (!todo) return null;
  if (patch.text !== undefined) todo.text = patch.text;
  if (patch.dueDate !== undefined) todo.dueDate = patch.dueDate || null;
  if (patch.done !== undefined) {
    todo.done = !!patch.done;
    // Tick -> stamp today's local date (so the Calendar shows what got
    // done that day); un-tick -> forget it ever was done today.
    todo.doneAt = todo.done ? localDateStr(new Date()) : null;
  }
  await write(data);
  return todo;
}

async function remove(id) {
  const data = read();
  const before = data.todos.length;
  data.todos = data.todos.filter((t) => t.id !== id);
  if (data.todos.length === before) return false;
  await write(data);
  return true;
}

module.exports = { list, listPending, add, update, remove, localDateStr };
