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
  // v1.2.1: Rec ("recorded lecture/video watched on YouTube") is a
  // genuinely separate kind of tracked time from Study, sharing only
  // the subjects list - NOT the same array with a "type" flag. Kept as
  // its own top-level fields (recSessions/activeRecSession) so a future
  // query/loop over `sessions`/`activeSession` can never accidentally
  // pick up Rec data or vice versa. See PROJECT_BRIEFING.md's v1.2.1
  // section for the full reasoning.
  recSessions: [],
  activeRecSession: null,
  // v1.3.7: Paper ("past papers / exam papers done") is a third kind of
  // tracked time, same shape as Rec: genuinely separate top-level
  // fields (paperSessions/activePaperSession), sharing only the
  // subjects list. See the Rec comment above for why separate fields
  // rather than one array with a type flag.
  paperSessions: [],
  activePaperSession: null,
  settings: { ...DEFAULT_SETTINGS },
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULTS, null, 2));

let writeQueue = Promise.resolve();

// v1.3.1 perf fix: cache the parsed-from-disk data in memory. The
// focus-session UI polls its status endpoint once a second while
// running (public/js/study.js), which used to mean a synchronous file
// read + full normalization on every single one of those polls. This
// process is the only writer, so a plain in-memory cache is safe, and
// the same normalize-on-read shape below is kept identical - just
// pointed at the cached object instead of a fresh disk read.
let rawCache = null;

function loadRaw() {
  if (rawCache) return rawCache;
  try {
    rawCache = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    rawCache = {};
  }
  return rawCache;
}

function read() {
  const data = loadRaw();
  return {
    subjects: Array.isArray(data.subjects) ? data.subjects : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    activeSession: data.activeSession || null,
    recSessions: Array.isArray(data.recSessions) ? data.recSessions : [],
    activeRecSession: data.activeRecSession || null,
    paperSessions: Array.isArray(data.paperSessions) ? data.paperSessions : [],
    activePaperSession: data.activePaperSession || null,
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
  };
}

function write(data) {
  rawCache = data;
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
    // v1.2.1: same guard, for an in-progress Rec timer.
    if (data.activeRecSession && data.activeRecSession.subjectId === id) {
      return { error: 'You are currently timing a recording for this subject - finish or cancel that Rec timer first.' };
    }
    // v1.3.7: same guard, for an in-progress Paper timer.
    if (data.activePaperSession && data.activePaperSession.subjectId === id) {
      return { error: 'You are currently timing a paper for this subject - finish or cancel that Paper timer first.' };
    }
    data.subjects = data.subjects.filter((s) => s.id !== id);
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
}

// v1.2.0: a subject can have a manually-picked, permanently-saved pie/bar
// chart color (data/study.json's subjects[].color). Empty string/absent
// means "no custom color" - the frontend falls back to its existing
// deterministic hash-of-id color in that case (see colorForSubject() in
// public/js/study.js), so old subjects with no color field keep working
// exactly as before with zero migration needed here.
async function setSubjectColor(id, color) {
  const clean = (color || '').trim();
  if (clean !== '' && !/^#[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error('Color must be a hex code like #4b3f8f (or empty to go back to the automatic color).');
  }
  const result = await update((data) => {
    const s = data.subjects.find((x) => x.id === id);
    if (!s) return { error: 'Subject not found.' };
    if (clean === '') delete s.color;
    else s.color = clean.toLowerCase();
    return { subject: s };
  });
  if (result.error) throw new Error(result.error);
  return result.subject;
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

// ---------------- Rec: recorded-lecture/video timer (v1.2.1) ----------------
//
// A Rec session is a plain manual timer (pick a subject, start, stop -
// same mechanic as Study's Stopwatch mode) against the *same subjects
// list* Study uses, but it is a genuinely separate kind of tracked time
// from a Study session, not the same thing with a label on it:
//   - Its own data: `recSessions` (saved) / `activeRecSession` (at most
//     one in-progress), never merged into `sessions`/`activeSession`
//     and never sharing one array with a "type" discriminator.
//   - Starting/stopping a Rec timer is fully independent of any active
//     Study session and vice versa - neither blocks the other (see
//     startRecSession/startSession - each only checks its own slot).
//   - No Pomodoro mode here - there's no "rest phase" concept for
//     watching a recording, so this reuses only the plain elapsed-time
//     math (rawElapsedMs, already generic) and none of
//     computeActiveView's Pomodoro phase logic.
function computeActiveRecView(session, subjectsById, now) {
  if (!session) return null;
  const elapsedMs = rawElapsedMs(session, now);
  const subjectName = (subjectsById[session.subjectId] && subjectsById[session.subjectId].name) || '(deleted subject)';
  return {
    id: session.id,
    subjectId: session.subjectId,
    subjectName,
    running: session.running,
    startedAt: session.startedAt,
    elapsedMs,
  };
}

async function getRecActive() {
  const data = read();
  if (!data.activeRecSession) return null;
  const subjectsById = {};
  data.subjects.forEach((s) => { subjectsById[s.id] = s; });
  return computeActiveRecView(data.activeRecSession, subjectsById, Date.now());
}

async function startRecSession({ subjectId }) {
  const result = await update((data) => {
    if (data.activeRecSession) {
      return { error: 'You already have a Rec timer running - finish or cancel it first.' };
    }
    const subject = data.subjects.find((s) => s.id === subjectId);
    if (!subject) return { error: 'Pick a subject first.' };
    const now = Date.now();
    const session = {
      id: genId('rec'),
      subjectId,
      running: true,
      startedAt: now,
      segmentStartedAt: now,
      accumulatedMs: 0,
    };
    data.activeRecSession = session;
    const subjectsById = { [subject.id]: subject };
    return { view: computeActiveRecView(session, subjectsById, now) };
  });
  if (result.error) throw new Error(result.error);
  return result.view;
}

async function pauseRecActive() {
  const result = await update((data) => {
    const s = data.activeRecSession;
    if (!s) return { error: 'No Rec timer is running.' };
    if (s.running) {
      const now = Date.now();
      s.accumulatedMs = rawElapsedMs(s, now);
      s.running = false;
      s.segmentStartedAt = null;
    }
    const subjectsById = {};
    data.subjects.forEach((x) => { subjectsById[x.id] = x; });
    return { view: computeActiveRecView(s, subjectsById, Date.now()) };
  });
  if (result.error) throw new Error(result.error);
  return result.view;
}

async function resumeRecActive() {
  const result = await update((data) => {
    const s = data.activeRecSession;
    if (!s) return { error: 'No Rec timer is running.' };
    if (!s.running) {
      s.running = true;
      s.segmentStartedAt = Date.now();
    }
    const subjectsById = {};
    data.subjects.forEach((x) => { subjectsById[x.id] = x; });
    return { view: computeActiveRecView(s, subjectsById, Date.now()) };
  });
  if (result.error) throw new Error(result.error);
  return result.view;
}

async function cancelRecActive() {
  const result = await update((data) => {
    if (!data.activeRecSession) return { error: 'No Rec timer is running.' };
    data.activeRecSession = null;
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
}

// Same "too short to bother logging" 5-second discard threshold as
// Study's finishActive(), for the same reason (an accidental double
// click of Start/Stop shouldn't clutter recSessions/stats with a
// 0-second entry).
async function finishRecActive() {
  const result = await update((data) => {
    const s = data.activeRecSession;
    if (!s) return { error: 'No Rec timer is running.' };
    const now = Date.now();
    const elapsedMs = rawElapsedMs(s, now);
    data.activeRecSession = null;
    if (elapsedMs < 5000) {
      return { discarded: true, durationMs: elapsedMs };
    }
    const entry = {
      id: genId('reclog'),
      subjectId: s.subjectId,
      date: localDateStr(new Date(s.startedAt)),
      durationMs: elapsedMs,
      startedAt: s.startedAt,
      endedAt: now,
    };
    data.recSessions.push(entry);
    return { discarded: false, session: entry };
  });
  if (result.error) throw new Error(result.error);
  return result;
}

// ---------------- Manual Rec entry (v1.3.6) ----------------

async function addManualRecSession({ subjectId, date, durationMs }) {
  if (!subjectId) throw new Error('Pick a subject.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Invalid date.');
  if (!Number.isFinite(durationMs) || durationMs < 60000) throw new Error('Duration must be at least 1 minute.');
  const result = await update((data) => {
    const subject = data.subjects.find((s) => s.id === subjectId);
    if (!subject) return { error: 'Subject not found.' };
    const now = Date.now();
    const entry = {
      id: genId('reclog'),
      subjectId,
      date,
      durationMs,
      startedAt: now,
      endedAt: now,
    };
    data.recSessions.push(entry);
    return { session: entry };
  });
  if (result.error) throw new Error(result.error);
  return result.session;
}

// ---------------- Paper: past-paper/exam timer (v1.3.7) ----------------
//
// A Paper session is a plain manual timer (pick a subject, start, stop)
// against the *same subjects list* Study uses, exactly like Rec - it is
// a third genuinely separate kind of tracked time ("past papers / exam
// papers done"), not Study with a label on it:
//   - Its own data: `paperSessions` (saved) / `activePaperSession` (at
//     most one in-progress), never merged into `sessions`/`activeSession`
//     and never sharing one array with a "type" discriminator - see the
//     v1.2.1 Rec comment above for why separate fields.
//   - Starting/stopping a Paper timer is fully independent of any active
//     Study or Rec session and vice versa - each only checks its own slot.
//   - No Pomodoro mode - same reasoning as Rec, reuses only the plain
//     elapsed-time math (rawElapsedMs, already generic).
function computeActivePaperView(session, subjectsById, now) {
  if (!session) return null;
  const elapsedMs = rawElapsedMs(session, now);
  const subjectName = (subjectsById[session.subjectId] && subjectsById[session.subjectId].name) || '(deleted subject)';
  return {
    id: session.id,
    subjectId: session.subjectId,
    subjectName,
    running: session.running,
    startedAt: session.startedAt,
    elapsedMs,
  };
}

async function getPaperActive() {
  const data = read();
  if (!data.activePaperSession) return null;
  const subjectsById = {};
  data.subjects.forEach((s) => { subjectsById[s.id] = s; });
  return computeActivePaperView(data.activePaperSession, subjectsById, Date.now());
}

async function startPaperSession({ subjectId }) {
  const result = await update((data) => {
    if (data.activePaperSession) {
      return { error: 'You already have a Paper timer running - finish or cancel it first.' };
    }
    const subject = data.subjects.find((s) => s.id === subjectId);
    if (!subject) return { error: 'Pick a subject first.' };
    const now = Date.now();
    const session = {
      id: genId('ppr'),
      subjectId,
      running: true,
      startedAt: now,
      segmentStartedAt: now,
      accumulatedMs: 0,
    };
    data.activePaperSession = session;
    const subjectsById = { [subject.id]: subject };
    return { view: computeActivePaperView(session, subjectsById, now) };
  });
  if (result.error) throw new Error(result.error);
  return result.view;
}

async function pausePaperActive() {
  const result = await update((data) => {
    const s = data.activePaperSession;
    if (!s) return { error: 'No Paper timer is running.' };
    if (s.running) {
      const now = Date.now();
      s.accumulatedMs = rawElapsedMs(s, now);
      s.running = false;
      s.segmentStartedAt = null;
    }
    const subjectsById = {};
    data.subjects.forEach((x) => { subjectsById[x.id] = x; });
    return { view: computeActivePaperView(s, subjectsById, Date.now()) };
  });
  if (result.error) throw new Error(result.error);
  return result.view;
}

async function resumePaperActive() {
  const result = await update((data) => {
    const s = data.activePaperSession;
    if (!s) return { error: 'No Paper timer is running.' };
    if (!s.running) {
      s.running = true;
      s.segmentStartedAt = Date.now();
    }
    const subjectsById = {};
    data.subjects.forEach((x) => { subjectsById[x.id] = x; });
    return { view: computeActivePaperView(s, subjectsById, Date.now()) };
  });
  if (result.error) throw new Error(result.error);
  return result.view;
}

async function cancelPaperActive() {
  const result = await update((data) => {
    if (!data.activePaperSession) return { error: 'No Paper timer is running.' };
    data.activePaperSession = null;
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
}

// Same "too short to bother logging" 5-second discard threshold as
// Study/Rec, for the same reason.
async function finishPaperActive() {
  const result = await update((data) => {
    const s = data.activePaperSession;
    if (!s) return { error: 'No Paper timer is running.' };
    const now = Date.now();
    const elapsedMs = rawElapsedMs(s, now);
    data.activePaperSession = null;
    if (elapsedMs < 5000) {
      return { discarded: true, durationMs: elapsedMs };
    }
    const entry = {
      id: genId('pprlog'),
      subjectId: s.subjectId,
      date: localDateStr(new Date(s.startedAt)),
      durationMs: elapsedMs,
      startedAt: s.startedAt,
      endedAt: now,
    };
    data.paperSessions.push(entry);
    return { discarded: false, session: entry };
  });
  if (result.error) throw new Error(result.error);
  return result;
}

// ---------------- Manual Paper entry (v1.3.7) ----------------

async function addManualPaperSession({ subjectId, date, durationMs }) {
  if (!subjectId) throw new Error('Pick a subject.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Invalid date.');
  if (!Number.isFinite(durationMs) || durationMs < 60000) throw new Error('Duration must be at least 1 minute.');
  const result = await update((data) => {
    const subject = data.subjects.find((s) => s.id === subjectId);
    if (!subject) return { error: 'Subject not found.' };
    const now = Date.now();
    const entry = {
      id: genId('pprlog'),
      subjectId,
      date,
      durationMs,
      startedAt: now,
      endedAt: now,
    };
    data.paperSessions.push(entry);
    return { session: entry };
  });
  if (result.error) throw new Error(result.error);
  return result.session;
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

// v1.3.3 perf: shared by getStats() (year scope) and getDayStats() (a
// single day, for Stats tab's new "Today" view and the Calendar tab's
// per-day breakdown) so the two never drift into two different ways of
// computing "totals per subject". Takes already-scoped (year- or
// day-filtered) session arrays and does one pass over each - the old
// getStats() used to re-`.filter()` the FULL sessions/recSessions
// arrays once per subject just to recover the per-subject session
// count it had already thrown away, which is O(subjects * sessions)
// for no reason; this folds those counts into the same single pass
// that totals up the ms. v1.3.7: same treatment for paperSessions.
function buildSubjectStats(scopedSessions, scopedRecSessions, scopedPaperSessions, subjectsById) {
  const msBySubjectStudy = {};
  const msBySubjectRec = {};
  const msBySubjectPaper = {};
  const countBySubjectStudy = {};
  const countBySubjectRec = {};
  const countBySubjectPaper = {};
  let studyOverallMs = 0;
  let recOverallMs = 0;
  let paperOverallMs = 0;

  for (const sess of scopedSessions) {
    studyOverallMs += sess.durationMs;
    msBySubjectStudy[sess.subjectId] = (msBySubjectStudy[sess.subjectId] || 0) + sess.durationMs;
    countBySubjectStudy[sess.subjectId] = (countBySubjectStudy[sess.subjectId] || 0) + 1;
  }
  for (const sess of scopedRecSessions) {
    recOverallMs += sess.durationMs;
    msBySubjectRec[sess.subjectId] = (msBySubjectRec[sess.subjectId] || 0) + sess.durationMs;
    countBySubjectRec[sess.subjectId] = (countBySubjectRec[sess.subjectId] || 0) + 1;
  }
  for (const sess of scopedPaperSessions) {
    paperOverallMs += sess.durationMs;
    msBySubjectPaper[sess.subjectId] = (msBySubjectPaper[sess.subjectId] || 0) + sess.durationMs;
    countBySubjectPaper[sess.subjectId] = (countBySubjectPaper[sess.subjectId] || 0) + 1;
  }

  const subjectIds = new Set([
    ...Object.keys(msBySubjectStudy),
    ...Object.keys(msBySubjectRec),
    ...Object.keys(msBySubjectPaper),
  ]);
  const subjectTotals = Array.from(subjectIds).map((subjectId) => {
    const studyMs = msBySubjectStudy[subjectId] || 0;
    const recMs = msBySubjectRec[subjectId] || 0;
    const paperMs = msBySubjectPaper[subjectId] || 0;
    return {
      subjectId,
      name: (subjectsById[subjectId] && subjectsById[subjectId].name) || '(deleted subject)',
      color: (subjectsById[subjectId] && subjectsById[subjectId].color) || null,
      studyMs,
      recMs,
      paperMs,
      totalMs: studyMs + recMs + paperMs,
      studySessionCount: countBySubjectStudy[subjectId] || 0,
      recSessionCount: countBySubjectRec[subjectId] || 0,
      paperSessionCount: countBySubjectPaper[subjectId] || 0,
    };
  }).sort((a, b) => b.totalMs - a.totalMs);

  return {
    subjectTotals,
    studyOverallMs,
    recOverallMs,
    paperOverallMs,
    studySessionCount: scopedSessions.length,
    recSessionCount: scopedRecSessions.length,
    paperSessionCount: scopedPaperSessions.length,
  };
}

async function getStats(year) {
  const data = read();
  const y = Number(year) || new Date().getFullYear();
  const todayStr = localDateStr(new Date());
  const prefix = `${y}-`;

  const subjectsById = {};
  data.subjects.forEach((s) => { subjectsById[s.id] = s; });

  // Scope both arrays to this year ONCE - buildSubjectStats(), the
  // msByDay loop and the msByMonth loop below all reuse these same two
  // arrays instead of each re-filtering the full (all-years) lists,
  // fixing an O(subjects * sessions) re-filter that used to happen
  // once per subject just to recover a per-subject session count.
  // v1.3.7: same for paperSessions.
  const yearSessions = data.sessions.filter((s) => s.date.startsWith(prefix));
  const yearRecSessions = data.recSessions.filter((s) => s.date.startsWith(prefix));
  const yearPaperSessions = data.paperSessions.filter((s) => s.date.startsWith(prefix));

  const msByDay = {}; // date -> total STUDY ms that day (this year only)
  const msByMonth = new Array(12).fill(0);
  const msBySubjectByDay = {}; // date -> { subjectId -> totalMs } (Study + Rec + Paper, for dominant-subject coloring)
  // v1.3.7: per-subject ms per month, for Stats' "Hours by month"
  // stacked-by-subject bars - new field, does NOT replace msByMonth
  // (which stays the month total used by the bar scale/labels).
  const msBySubjectByMonth = new Array(12).fill(null).map(() => ({}));

  for (const sess of yearSessions) {
    msByDay[sess.date] = (msByDay[sess.date] || 0) + sess.durationMs;
    const monthIdx = Number(sess.date.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      msByMonth[monthIdx] += sess.durationMs;
      msBySubjectByMonth[monthIdx][sess.subjectId] = (msBySubjectByMonth[monthIdx][sess.subjectId] || 0) + sess.durationMs;
    }
    if (!msBySubjectByDay[sess.date]) msBySubjectByDay[sess.date] = {};
    msBySubjectByDay[sess.date][sess.subjectId] = (msBySubjectByDay[sess.date][sess.subjectId] || 0) + sess.durationMs;
  }
  for (const sess of yearRecSessions) {
    const monthIdx = Number(sess.date.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      msByMonth[monthIdx] += sess.durationMs;
      msBySubjectByMonth[monthIdx][sess.subjectId] = (msBySubjectByMonth[monthIdx][sess.subjectId] || 0) + sess.durationMs;
    }
    if (!msBySubjectByDay[sess.date]) msBySubjectByDay[sess.date] = {};
    msBySubjectByDay[sess.date][sess.subjectId] = (msBySubjectByDay[sess.date][sess.subjectId] || 0) + sess.durationMs;
  }
  for (const sess of yearPaperSessions) {
    const monthIdx = Number(sess.date.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      msByMonth[monthIdx] += sess.durationMs;
      msBySubjectByMonth[monthIdx][sess.subjectId] = (msBySubjectByMonth[monthIdx][sess.subjectId] || 0) + sess.durationMs;
    }
    if (!msBySubjectByDay[sess.date]) msBySubjectByDay[sess.date] = {};
    msBySubjectByDay[sess.date][sess.subjectId] = (msBySubjectByDay[sess.date][sess.subjectId] || 0) + sess.durationMs;
  }

  const { subjectTotals, studyOverallMs, recOverallMs, paperOverallMs, studySessionCount, recSessionCount, paperSessionCount } =
    buildSubjectStats(yearSessions, yearRecSessions, yearPaperSessions, subjectsById);
  const overallMs = studyOverallMs + recOverallMs + paperOverallMs;
  const sessionCount = studySessionCount + recSessionCount + paperSessionCount;

  const monthly = msByMonth.map((ms, i) => ({ month: i + 1, ms }));
  const monthlySubjectMs = msBySubjectByMonth.map((subjects, i) => ({ month: i + 1, subjects }));

  let studiedDays = 0;
  const heatmap = daysInYear(y).map((date) => {
    const ms = msByDay[date] || 0;
    const minutes = Math.round(ms / 60000);
    if (date <= todayStr && ms > 0) studiedDays++;
    let dominantSubjectId = null;
    let dominantColor = null;
    // v1.4.0: topSubjects - EVERY subject tied at the day's maximum
    // time, not just the first one found. Fixes the calendar bug where
    // a day with two subjects on equal top time (e.g. 2h Literature AND
    // 2h Geography) could only show one of them, leaving the cell a
    // single color and the tooltip silent about the tie. Each entry
    // carries subjectName + color so the frontend can split the cell
    // and label it without a second lookup. Sorted descending by ms.
    const topSubjects = [];
    const subjMap = msBySubjectByDay[date];
    if (subjMap) {
      let maxMs = 0;
      for (const sms of Object.values(subjMap)) {
        if (sms > maxMs) maxMs = sms;
      }
      for (const [sid, sms] of Object.entries(subjMap)) {
        if (sms === maxMs && sms > 0) {
          const subj = subjectsById[sid];
          topSubjects.push({ subjectId: sid, subjectName: (subj && subj.name) || sid, color: (subj && subj.color) || null, ms: sms });
        }
      }
      topSubjects.sort((a, b) => b.ms - a.ms);
      const top = topSubjects[0];
      if (top) {
        dominantSubjectId = top.subjectId;
        dominantColor = top.color;
      }
    }
    // v1.3.7: totalMinutes (Study + Rec + Paper) drives the Calendar
    // cells' color INTENSITY (see public/js/study.js's renderCalendarTab
    // - the dominant subject color is scaled by how much total time that
    // day actually had, so a 10-minute day no longer looks identical to
    // a 5-hour one). `ms`/`minutes` stay STUDY-only, as before, so the
    // tooltip and studiedDays count keep meaning "study".
    let totalMinutes = minutes;
    const subjMapAll = msBySubjectByDay[date];
    if (subjMapAll) {
      let total = 0;
      for (const sms of Object.values(subjMapAll)) total += sms;
      totalMinutes = Math.round(total / 60000);
    }
    return { date, ms, minutes, totalMinutes, level: levelForMinutes(minutes), dominantSubjectId, dominantColor, topSubjects };
  });

  return {
    year: y,
    overallMs,
    studyOverallMs,
    recOverallMs,
    paperOverallMs,
    sessionCount,
    studySessionCount,
    recSessionCount,
    paperSessionCount,
    subjectTotals,
    monthly,
    monthlySubjectMs,
    studiedDays,
    heatmap,
  };
}

// v1.3.3: stats scoped to exactly one calendar day, same shape (minus
// the year-only fields - `monthly`/`heatmap`/`dayCounts` don't mean
// anything for a single day) as getStats() above, built with the same
// buildSubjectStats() helper so "today" in the Stats tab and a clicked
// day in the Calendar tab can never disagree with each other or with
// the year view about how a day's time is totalled up. Used by:
//   - Stats tab's "Today" sub-view (public/js/study.js) - the same
//     page layout as "Total", just handed this instead of getStats().
//   - Calendar tab's per-day panel, for ANY clicked day (not just ones
//     with a session) - shows a real (if mostly-zero) breakdown rather
//     than only ever "you studied N minutes" plain text.
async function getDayStats(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Invalid date.');
  const data = read();
  const subjectsById = {};
  data.subjects.forEach((s) => { subjectsById[s.id] = s; });

  const daySessions = data.sessions.filter((s) => s.date === date);
  const dayRecSessions = data.recSessions.filter((s) => s.date === date);
  const dayPaperSessions = data.paperSessions.filter((s) => s.date === date);
  const { subjectTotals, studyOverallMs, recOverallMs, paperOverallMs, studySessionCount, recSessionCount, paperSessionCount } =
    buildSubjectStats(daySessions, dayRecSessions, dayPaperSessions, subjectsById);
  const overallMs = studyOverallMs + recOverallMs + paperOverallMs;

  return {
    date,
    overallMs,
    studyOverallMs,
    recOverallMs,
    paperOverallMs,
    sessionCount: studySessionCount + recSessionCount + paperSessionCount,
    studySessionCount,
    recSessionCount,
    paperSessionCount,
    subjectTotals,
    minutes: Math.round(studyOverallMs / 60000),
    isFuture: date > localDateStr(new Date()),
  };
}

module.exports = {
  listSubjects,
  addSubject,
  renameSubject,
  deleteSubject,
  setSubjectColor,
  getSettings,
  setSettings,
  getActive,
  startSession,
  pauseActive,
  resumeActive,
  cancelActive,
  finishActive,
  getRecActive,
  startRecSession,
  pauseRecActive,
  resumeRecActive,
  cancelRecActive,
  finishRecActive,
  addManualRecSession,
  getPaperActive,
  startPaperSession,
  pausePaperActive,
  resumePaperActive,
  cancelPaperActive,
  finishPaperActive,
  addManualPaperSession,
  getStats,
  getDayStats,
  localDateStr,
};
