// Study subsystem storage - fully independent of every other subsystem
// (own file, own data file, no cross-references), same isolation
// pattern as lib/schedule-store.js / lib/stopwatch-store.js.
//
// What lives in data/study.json:
//   subjects        - the list of things the user can study
//   sessions        - finished, saved study sessions (subject + date +
//                     how much was actually studied)
//   activeSession   - AT MOST ONE in-progress session (stopwatch or
//                     Pomodoro). Server-authoritative like Stopwatch
//                     (lib/stopwatch-store.js): elapsed/phase time is
//                     derived purely from stored timestamps + wall
//                     clock whenever it's read, so it survives page
//                     reloads and server restarts with zero background
//                     tick loop. Unlike Clock's Timer/Alarm, there's no
//                     server-side beep here - studying is a foreground
//                     activity (the point is you're at the page), so a
//                     browser-side Web Audio beep on phase change
//                     (public/js/study.js) is enough, and it means this
//                     subsystem needs no GET /api/busy entry either -
//                     exactly the same reasoning PROJECT_BRIEFING.md
//                     gives for why Stopwatch doesn't need one.
//   dayLogs         - manual "how was this day" marks for days with NO
//                     study session ('slept' | 'nothing'). A day WITH
//                     at least one session is always 'studied' - that's
//                     derived from `sessions`, never stored here, so it
//                     can't drift out of sync with the actual data.
//   settings        - Pomodoro study/rest minutes. Saved forever in
//                     data/study.json (same folder as every other
//                     subsystem's data - never touched by the update
//                     process, see apply-update.ps1). CRITICAL: a
//                     session captures its own studyMin/restMin at
//                     START time (see startSession below) and never
//                     re-reads `settings` again after that - so
//                     changing the settings mid-session, or mid any
//                     other already-saved session, can never change
//                     that session's numbers after the fact. This was
//                     an explicit requirement.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'study.json');

const DEFAULT_SETTINGS = { pomodoroStudyMin: 25, pomodoroRestMin: 5 };

const DEFAULTS = {
  subjects: [],
  sessions: [],
  activeSession: null,
  dayLogs: {},
  settings: { ...DEFAULT_SETTINGS },
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULTS, null, 2));

let writeQueue = Promise.resolve();

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    return {
      subjects: Array.isArray(data.subjects) ? data.subjects : [],
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      activeSession: data.activeSession || null,
      dayLogs: data.dayLogs && typeof data.dayLogs === 'object' ? data.dayLogs : {},
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    };
  } catch (e) {
    return { ...DEFAULTS, subjects: [], sessions: [], dayLogs: {}, settings: { ...DEFAULT_SETTINGS } };
  }
}

function write(data) {
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

// Serializes every mutation through one promise chain, same pattern as
// every other store in this project (stopwatch-store.js, timers-store.js,
// schedule-store.js) - avoids two near-simultaneous requests
// read-modify-writing over each other and losing an update.
//
// IMPORTANT: `mutator` must never throw. `writeQueue` is a single
// long-lived promise chain - `.then()` on an already-REJECTED promise
// skips straight to rejection without running the callback. So if a
// mutator ever threw here, writeQueue itself would become permanently
// rejected, and every future call to update() - forever, until the
// server restarts - would silently reject too, even for completely
// unrelated requests. This is the exact bug documented in
// landing-page/lib/sites-store.js's own `update()` (found for real
// there, same lesson applies here): every function below does its
// validation and existence-checks either before calling update() at
// all, or by having the mutator return a `{ error: '...' }` sentinel
// object (checked and thrown AFTER update() has already resolved
// successfully) rather than throwing from inside the mutator itself.
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

// Local (server machine) calendar date as YYYY-MM-DD - deliberately
// local time, not UTC, so "today" lines up with when the user is
// actually sitting there studying, same spirit as Clock's Alarm using
// local HH:MM.
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------- Subjects ----------------

async function listSubjects() {
  const data = read();
  return data.subjects;
}

async function addSubject(name) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('Give the subject a name.');
  if (clean.length > 60) throw new Error('Subject name is too long (max 60 characters).');
  const result = await update((data) => {
    if (data.subjects.some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
      return { error: 'You already have a subject with that name.' };
    }
    const entry = { id: genId('subj'), name: clean, createdAt: new Date().toISOString() };
    data.subjects.push(entry);
    return { entry };
  });
  if (result.error) throw new Error(result.error);
  return result.entry;
}

async function renameSubject(id, name) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('Give the subject a name.');
  if (clean.length > 60) throw new Error('Subject name is too long (max 60 characters).');
  const result = await update((data) => {
    const s = data.subjects.find((x) => x.id === id);
    if (!s) return { error: 'Subject not found.' };
    s.name = clean;
    return { subject: s };
  });
  if (result.error) throw new Error(result.error);
  return result.subject;
}

async function deleteSubject(id) {
  // Past sessions logged under this subject are kept (deliberately) -
  // deleting a subject shouldn't quietly erase real study history. The
  // frontend/stats layer show them as "(deleted subject)" by name
  // lookup falling through. Also refuses to delete while it's the
  // subject of the current active session, so you can't orphan the
  // session you're mid-way through.
  const result = await update((data) => {
    if (data.activeSession && data.activeSession.subjectId === id) {
      return { error: 'You are currently studying this subject - finish or cancel that session first.' };
    }
    data.subjects = data.subjects.filter((s) => s.id !== id);
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
}

// ---------------- Settings (Pomodoro study/rest minutes) ----------------

async function getSettings() {
  const data = read();
  return data.settings;
}

async function setSettings(partial) {
  const studyMin = Number(partial.pomodoroStudyMin);
  const restMin = Number(partial.pomodoroRestMin);
  if (!Number.isFinite(studyMin) || studyMin < 1 || studyMin > 180) {
    throw new Error('Study length must be between 1 and 180 minutes.');
  }
  if (!Number.isFinite(restMin) || restMin < 1 || restMin > 60) {
    throw new Error('Rest length must be between 1 and 60 minutes.');
  }
  return update((data) => {
    // Deliberately ONLY touches `settings`. The active session (if any)
    // already has its own frozen pomodoroStudyMin/pomodoroRestMin copied
    // in at start time (see startSession) and this never reaches in and
    // edits that copy - so updating settings can never retroactively
    // change a session that's already running or already saved. This
    // was an explicit requirement ("saved forever, updating shouldn't
    // change [existing sessions]").
    data.settings = { pomodoroStudyMin: studyMin, pomodoroRestMin: restMin };
    return data.settings;
  });
}

// ---------------- Active session (stopwatch or Pomodoro) ----------------

// How much of `elapsedMs` (total time since the session's own start,
// pause time excluded) counts as *actually studying* for a Pomodoro
// session - i.e. excluding rest-phase time. A plain Stopwatch session
// has no rest phases, so 100% of its elapsed time counts.
function studiedMsForPomodoro(elapsedMs, studyMin, restMin) {
  const studyMs = studyMin * 60000;
  const restMs = restMin * 60000;
  const cycleMs = studyMs + restMs;
  const fullCycles = Math.floor(elapsedMs / cycleMs);
  const remainder = elapsedMs - fullCycles * cycleMs;
  return fullCycles * studyMs + Math.min(remainder, studyMs);
}

// Raw elapsed ms since the session began, pause segments excluded - the
// same accumulatedMs + (running ? now - segmentStartedAt : 0) shape
// stopwatch-store.js already uses, reused here rather than reinvented.
function rawElapsedMs(session, now) {
  const live = session.running ? Math.max(0, now - session.segmentStartedAt) : 0;
  return session.accumulatedMs + live;
}

// Turns the raw stored activeSession into what the frontend actually
// needs to render right now (phase, remaining time, etc.) - computed
// fresh from timestamps every time this is called, never stored, so it
// can never go stale.
function computeActiveView(session, subjectsById, now) {
  if (!session) return null;
  const elapsedMs = rawElapsedMs(session, now);
  const subjectName = (subjectsById[session.subjectId] && subjectsById[session.subjectId].name) || '(deleted subject)';
  const base = {
    id: session.id,
    subjectId: session.subjectId,
    subjectName,
    method: session.method,
    running: session.running,
    startedAt: session.startedAt,
    elapsedMs,
  };
  if (session.method !== 'pomodoro') return base;

  const { pomodoroStudyMin: studyMin, pomodoroRestMin: restMin } = session;
  const studyMs = studyMin * 60000;
  const restMs = restMin * 60000;
  const cycleMs = studyMs + restMs;
  const cycleIndex = Math.floor(elapsedMs / cycleMs);
  const posInCycle = elapsedMs - cycleIndex * cycleMs;
  const inStudyPhase = posInCycle < studyMs;
  const phase = inStudyPhase ? 'study' : 'rest';
  const phaseElapsedMs = inStudyPhase ? posInCycle : posInCycle - studyMs;
  const phaseDurationMs = inStudyPhase ? studyMs : restMs;
  return {
    ...base,
    pomodoroStudyMin: studyMin,
    pomodoroRestMin: restMin,
    cyclesCompleted: cycleIndex,
    phase,
    phaseElapsedMs,
    phaseDurationMs,
    phaseRemainingMs: Math.max(0, phaseDurationMs - phaseElapsedMs),
    studiedMs: studiedMsForPomodoro(elapsedMs, studyMin, restMin),
  };
}

async function getActive() {
  const data = read();
  if (!data.activeSession) return null;
  const subjectsById = {};
  data.subjects.forEach((s) => { subjectsById[s.id] = s; });
  return computeActiveView(data.activeSession, subjectsById, Date.now());
}

async function startSession({ subjectId, method }) {
  const kind = method === 'pomodoro' ? 'pomodoro' : 'stopwatch';
  const result = await update((data) => {
    if (data.activeSession) {
      return { error: 'You already have a study session running - finish or cancel it first.' };
    }
    const subject = data.subjects.find((s) => s.id === subjectId);
    if (!subject) return { error: 'Pick a subject first.' };
    const now = Date.now();
    const session = {
      id: genId('ses'),
      subjectId,
      method: kind,
      running: true,
      startedAt: now,
      segmentStartedAt: now,
      accumulatedMs: 0,
    };
    if (kind === 'pomodoro') {
      // Frozen at start time on purpose - see the big comment above
      // setSettings(). Changing Settings later never touches these.
      session.pomodoroStudyMin = data.settings.pomodoroStudyMin;
      session.pomodoroRestMin = data.settings.pomodoroRestMin;
    }
    data.activeSession = session;
    const subjectsById = { [subject.id]: subject };
    return { view: computeActiveView(session, subjectsById, now) };
  });
  if (result.error) throw new Error(result.error);
  return result.view;
}

async function pauseActive() {
  const result = await update((data) => {
    const s = data.activeSession;
    if (!s) return { error: 'No study session is running.' };
    if (s.running) {
      const now = Date.now();
      s.accumulatedMs = rawElapsedMs(s, now);
      s.running = false;
      s.segmentStartedAt = null;
    }
    const subjectsById = {};
    data.subjects.forEach((x) => { subjectsById[x.id] = x; });
    return { view: computeActiveView(s, subjectsById, Date.now()) };
  });
  if (result.error) throw new Error(result.error);
  return result.view;
}

async function resumeActive() {
  const result = await update((data) => {
    const s = data.activeSession;
    if (!s) return { error: 'No study session is running.' };
    if (!s.running) {
      s.running = true;
      s.segmentStartedAt = Date.now();
    }
    const subjectsById = {};
    data.subjects.forEach((x) => { subjectsById[x.id] = x; });
    return { view: computeActiveView(s, subjectsById, Date.now()) };
  });
  if (result.error) throw new Error(result.error);
  return result.view;
}

async function cancelActive() {
  const result = await update((data) => {
    if (!data.activeSession) return { error: 'No study session is running.' };
    data.activeSession = null;
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
}

// Ends the active session and saves it into `sessions` for real, using
// whatever counts as "actually studied" ms (all of it for Stopwatch,
// study-phase-only for Pomodoro - rest breaks don't count towards your
// hours studied). Requires at least a few seconds of real elapsed time
// so an accidental double-click of Start/Stop doesn't pollute history
// with 0-second entries.
async function finishActive() {
  const result = await update((data) => {
    const s = data.activeSession;
    if (!s) return { error: 'No study session is running.' };
    const now = Date.now();
    const elapsedMs = rawElapsedMs(s, now);
    const studiedMs = s.method === 'pomodoro'
      ? studiedMsForPomodoro(elapsedMs, s.pomodoroStudyMin, s.pomodoroRestMin)
      : elapsedMs;
    data.activeSession = null;
    if (studiedMs < 5000) {
      // Too short to bother logging (e.g. started then immediately
      // stopped by mistake) - discard quietly rather than cluttering
      // history/stats with it.
      return { discarded: true, studiedMs };
    }
    const entry = {
      id: genId('log'),
      subjectId: s.subjectId,
      method: s.method,
      date: localDateStr(new Date(s.startedAt)),
      durationMs: studiedMs,
      totalElapsedMs: elapsedMs,
      startedAt: s.startedAt,
      endedAt: now,
    };
    data.sessions.push(entry);
    return { discarded: false, session: entry };
  });
  if (result.error) throw new Error(result.error);
  return result;
}

// ---------------- Manual day logs (slept / did nothing) ----------------

async function setDayLog(date, status) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Invalid date.');
  if (status !== null && status !== 'slept' && status !== 'nothing') {
    throw new Error('Status must be "slept", "nothing", or null to clear.');
  }
  const result = await update((data) => {
    // A day that already has a real study session is always 'studied' -
    // refuse to let a manual mark paper over real data.
    const hasSession = data.sessions.some((sess) => sess.date === date);
    if (hasSession) return { error: 'This day already has a study session logged - it counts as studied.' };
    // Can't manually log a day in the future - nothing has happened yet.
    if (date > localDateStr(new Date())) return { error: "Can't log a day that hasn't happened yet." };
    if (status === null) delete data.dayLogs[date];
    else data.dayLogs[date] = status;
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
}

// ---------------- Stats / heatmap ----------------

function daysInYear(year) {
  const days = [];
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(localDateStr(d));
  }
  return days;
}

// Fixed intensity thresholds (minutes studied that day) -> level 0-4,
// used for the GitHub-style heatmap coloring. Fixed rather than
// relative-to-max so a single very long session one day doesn't wash
// out every other day's color.
function levelForMinutes(min) {
  if (min <= 0) return 0;
  if (min < 30) return 1;
  if (min < 60) return 2;
  if (min < 120) return 3;
  return 4;
}

async function getStats(year) {
  const data = read();
  const y = Number(year) || new Date().getFullYear();
  const todayStr = localDateStr(new Date());

  const subjectsById = {};
  data.subjects.forEach((s) => { subjectsById[s.id] = s; });

  const msByDay = {}; // date -> total studied ms that day (this year only)
  const msBySubject = {}; // subjectId -> total studied ms (this year only)
  let overallMs = 0;
  let sessionCount = 0;

  for (const sess of data.sessions) {
    if (!sess.date.startsWith(`${y}-`)) continue;
    sessionCount++;
    overallMs += sess.durationMs;
    msByDay[sess.date] = (msByDay[sess.date] || 0) + sess.durationMs;
    msBySubject[sess.subjectId] = (msBySubject[sess.subjectId] || 0) + sess.durationMs;
  }

  const subjectTotals = Object.keys(msBySubject).map((subjectId) => ({
    subjectId,
    name: (subjectsById[subjectId] && subjectsById[subjectId].name) || '(deleted subject)',
    totalMs: msBySubject[subjectId],
    sessionCount: data.sessions.filter((s) => s.subjectId === subjectId && s.date.startsWith(`${y}-`)).length,
  })).sort((a, b) => b.totalMs - a.totalMs);

  const dayCounts = { studied: 0, slept: 0, nothing: 0 };
  const heatmap = daysInYear(y).map((date) => {
    const ms = msByDay[date] || 0;
    let status = null;
    if (ms > 0) status = 'studied';
    else if (data.dayLogs[date]) status = data.dayLogs[date];
    // Only count days up to and including today - can't have a status
    // for a day that hasn't happened yet.
    if (date <= todayStr && status) dayCounts[status]++;
    return { date, ms, minutes: Math.round(ms / 60000), status, level: levelForMinutes(ms / 60000) };
  });

  return {
    year: y,
    overallMs,
    sessionCount,
    subjectTotals,
    dayCounts,
    heatmap,
  };
}

module.exports = {
  listSubjects,
  addSubject,
  renameSubject,
  deleteSubject,
  getSettings,
  setSettings,
  getActive,
  startSession,
  pauseActive,
  resumeActive,
  cancelActive,
  finishActive,
  setDayLog,
  getStats,
  localDateStr,
};
