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
const DEFAULTS = {
  port: 3002,
  setupComplete: false,
  airdropMaxUsageGB: 30,
  airdropSaveLocation: '',
  lastAcknowledgedUpdateVersion: '',
  hiddenSubsystems: [],
  defaultLandingSubsystem: 'lessons',
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));

function get() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return { ...DEFAULTS, ...data };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function set(partial) {
  const current = get();
  const next = { ...current, ...partial };
  const tmpPath = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmpPath, CONFIG_PATH);
  return next;
}

module.exports = { get, set, CONFIG_PATH };
