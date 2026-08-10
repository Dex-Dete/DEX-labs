// Shared config store (currently just the port, more settings expected
// later per the tray app's Settings menu). Lives in data/config.json -
// same folder as db.json/airdrop.json, which means it automatically
// survives updates (the update process never touches the data/ folder),
// so a chosen port sticks around without the user needing to redo
// anything after an update.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

// v1.0.5 additions (see CHANGES.md):
//  - setupComplete / airdropMaxUsageGB / airdropSaveLocation: the new
//    "forced first-run setup" flow. Until setupComplete is true, the
//    website redirects every page to Settings until the user saves an
//    AirDrop max-usage + save-location choice (or accepts the
//    defaults). Also settable from the tray's Settings menu.
//  - lastAcknowledgedUpdateVersion: which version's "what's new" banner
//    the user has already dismissed with OK - so it's shown once per
//    new version, not on every page load.
//  - hiddenSubsystems / defaultLandingSubsystem: the "show/hide
//    subsystems" menu. hiddenSubsystems is an array of subsystem ids
//    (see lib/subsystems-registry.js) hidden from the site's nav (and
//    blocked from direct hash navigation). defaultLandingSubsystem is
//    which one loads first when the site is opened with no hash -
//    normally 'lessons', but if the user hides Lesson Tracker this is
//    how they pick what replaces it as the home screen.
// v1.3.0 additions:
//  - themeMode: 'auto' | 'dark' | 'light'. 'auto' follows the fixed
//    clock-hour day/night schedule below. Manually toggling sets this to
//    'dark' or 'light' and starts a 24h hold (themeOverrideUntil) - see
//    the theme section of app.js. After the hold expires, themeMode
//    reverts to 'auto' server-side (checked lazily on next read/write,
//    no background timer needed - see settings.js/app.js).
//  - themeOverrideUntil: epoch ms the manual override expires, or null.
//  - themeDarkStartHour / themeDarkEndHour: 24h-clock hours (0-23) that
//    bound "night" for auto mode. Default 19 (7pm) - 7 (7am). Simple
//    fixed local-clock-hours approach, not sunrise/sunset - see
//    PROJECT_BRIEFING.md v1.3.0 section for why.
//  - sbmStatsEnabled: Standby Mode's host RAM/CPU stats panel, on by
//    default (no temperature in v1.3.0 - not reliably available
//    cross-platform, see PROJECT_BRIEFING.md).
//  - sbmClockFormat: '12' | '24'. Scoped to SBM's own big clock only
//    (not global - confirmed with the user for v1.3.0).
//  - sbmUltraGraphics: SBM-specific "ultra animations/3D effects" toggle,
//    independent of the base dark/light styling. Off by default.
//  - sbmCreatureEnabled / sbmCreatureSize: the follow-mouse creature.
//    Only actually shows when dark mode + ultra graphics are BOTH on
//    (see sbm.js) - this toggle is an additional off-switch on top of
//    that. v1.3.0 scope is SBM only; sized 1(small)-10(large).
// v1.3.7 additions:
//  - studyChartFilters: which tracked-time kinds show in Study's "Time
//    by subject" pie/bar breakdown (Stats tab, both Total and Today, and
//    the Calendar tab's per-day panel). Global + saved forever (until
//    deliberately changed again) by explicit user requirement - the
//    three toggles (Study/Rec/Paper) next to the pie are NOT per-page or
//    per-session state. Shape: { study: bool, rec: bool, paper: bool }.
// v1.4.0 additions:
//  - sbmTodosEnabled: whether Standby Mode shows the "Today's To-Do"
//    card (pending to-dos due today or overdue, plus how many were done
//    today). On by default; toggleable from Settings > Standby Mode.
const DEFAULTS = {
  port: 3002,
  setupComplete: false,
  airdropMaxUsageGB: 30,
  airdropSaveLocation: '',
  lastAcknowledgedUpdateVersion: '',
  hiddenSubsystems: [],
  defaultLandingSubsystem: 'lessons',
  themeMode: 'auto',
  themeOverrideUntil: null,
  themeDarkStartHour: 19,
  themeDarkEndHour: 7,
  sbmStatsEnabled: true,
  sbmClockFormat: '24',
  sbmUltraGraphics: false,
  sbmCreatureEnabled: true,
  sbmCreatureSize: 5,
  sbmTodosEnabled: true,
  studyChartFilters: { study: true, rec: true, paper: true },
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));

// v1.3.1 perf fix: config gets read on practically every page/API
// request (theme, subsystem toggles, etc) - was hitting disk with a
// synchronous read every single time. Cache in memory instead; this
// process is the only writer, so the cache is always kept fresh by
// set() below.
let cache = null;

function get() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    cache = { ...DEFAULTS, ...data };
  } catch (e) {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function set(partial) {
  const current = get();
  const next = { ...current, ...partial };
  cache = next;
  const tmpPath = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmpPath, CONFIG_PATH);
  return next;
}

module.exports = { get, set, CONFIG_PATH };
