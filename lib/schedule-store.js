// Daily Schedule subsystem storage. A static 3-day x 3-subject grid that
// the user fills in once and it stays put until they deliberately edit
// it again - no dates, no rotation, no auto-anything. Fully independent
// of Lesson Tracker's subject list on purpose (per requirement: don't
// integrate this with the other subsystems) - subjects here are just
// free-text strings the user types in.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'schedule.json');

function defaultSchedule() {
  return {
    days: [
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ],
    updatedAt: null,
  };
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(defaultSchedule(), null, 2));

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!Array.isArray(data.days) || data.days.length !== 3) return defaultSchedule();
    return data;
  } catch (e) {
    return defaultSchedule();
  }
}

function write(data) {
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

function save(days) {
  const clean = days.slice(0, 3).map((day) => {
    const row = Array.isArray(day) ? day.slice(0, 3) : ['', '', ''];
    while (row.length < 3) row.push('');
    return row.map((s) => String(s || '').slice(0, 100));
  });
  while (clean.length < 3) clean.push(['', '', '']);
  const data = { days: clean, updatedAt: new Date().toISOString() };
  write(data);
  return data;
}

module.exports = { read, save };
