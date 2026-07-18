// Single source of truth for which subsystems exist and their nav
// metadata. Both the website's Settings page (GET/PUT
// /api/settings/subsystems) and the tray's Settings menu
// (Show-DexSubsystemsDialog in tray.ps1, which calls that same API) read
// this list rather than each keeping their own hardcoded copy -
// specifically so a future session adding subsystem #5, #6, ... #30+
// only has to touch ONE array, in ONE file, to have it show up
// correctly (and be hideable) everywhere.
//
// To add a new subsystem:
//   1. Build it as usual (own route file, own lib/*-store.js if it needs
//      one, own public/js/<name>.js frontend module, own
//      public/css/<name>.css if needed) - same isolation pattern this
//      whole project already uses for Lesson Tracker/AirDrop/Schedule/
//      Timers.
//   2. Add ONE entry below.
//   3. In public/js/<name>.js, at the bottom of its IIFE, self-register
//      alongside whatever `window.<Name> = { render }` it already
//      exports:
//        window.DexSubsystems = window.DexSubsystems || {};
//        window.DexSubsystems['<id>'] = { render };
//   4. Add its <script src="/js/<name>.js"> tag to public/index.html
//      (and a <link> for its CSS if it has one).
//   That's it - app.js's router (see the generic `window.DexSubsystems[...]`
//   fallback near the bottom of route()), the nav (built dynamically from
//   this list, see loadAndRenderNav()), and both Settings UIs (website +
//   tray) all pick it up automatically with zero further edits, as long
//   as `hash` here matches the `#/<id>` route your module expects to be
//   dispatched at.
//
// `id` must be a short, stable, URL-safe token (used as the hash segment
// and as the window.DexSubsystems key) - NEVER rename an existing id
// once shipped, since it's stored in user configs
// (hiddenSubsystems/defaultLandingSubsystem, data/config.json) that must
// keep working across updates.
//
// Settings itself is deliberately NOT in this list - it's always
// visible/non-hideable (someone has to be able to reach the settings
// that control everything else) and is handled as a special case in
// app.js/index.html rather than through the hide-menu machinery.
const SUBSYSTEMS = [
  { id: 'lessons', label: 'Lesson Tracker', navLabel: 'Lesson Tracker', hash: '#/', hideable: true },
  { id: 'airdrop', label: 'AirDrop', navLabel: '⇄ AirDrop', hash: '#/airdrop', hideable: true },
  { id: 'schedule', label: 'Daily Schedule', navLabel: '📅 Schedule', hash: '#/schedule', hideable: true },
  // v1.1.1: relabeled "Timers" -> "Clock" (id/hash left untouched on
  // purpose - see the "NEVER rename an existing id" note above; this is
  // just the display label). Clock now has 3 menus inside it (Timer /
  // Alarm / Stopwatch) - see public/js/timers.js. Still exactly ONE
  // subsystem, same as before - the 3 menus are internal navigation
  // within it, not 3 separate registry entries.
  { id: 'timers', label: 'Clock', navLabel: '🕐 Clock', hash: '#/timers', hideable: true },
  // v1.1.0: merged in from Part 1 - see public/js/ytdownload.js's
  // self-registration (window.DexSubsystems['ytdownload']) and
  // routes/ytdownload.js / lib/ytdownload-store.js for the rest of the
  // subsystem. Uses the generic window.DexSubsystems fallback in
  // app.js's route() - no special-casing needed there.
  { id: 'ytdownload', label: 'YouTube Downloader', navLabel: '⬇ YT Download', hash: '#/ytdownload', hideable: true },
  // v1.1.5: new subsystem. Uses the generic window.DexSubsystems
  // fallback in app.js's route() - no special-casing needed there, same
  // as ytdownload above. See public/js/study.js self-registration and
  // routes/study.js / lib/study-store.js for the rest of it.
  { id: 'study', label: 'Study', navLabel: '📖 Study', hash: '#/study', hideable: true },
];

function all() {
  return SUBSYSTEMS;
}
function ids() {
  return SUBSYSTEMS.map((s) => s.id);
}
function isValidId(id) {
  return ids().includes(id);
}

module.exports = { SUBSYSTEMS, all, ids, isValidId };
