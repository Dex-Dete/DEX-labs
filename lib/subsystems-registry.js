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
  // v1.3.0: hash changed from '#/' to '#/lessons'. '#/' used to double as
  // BOTH "the root/landing route" AND "Lesson Tracker's hash", which are
  // only the same thing when defaultLandingSubsystem happens to be
  // 'lessons' (the default, but user-changeable in Settings). Whenever
  // it was set to anything else, parseHash() reduced '#/' to an empty
  // parts[] array indistinguishable from "no hash at all", so
  // route()'s `parts.length === 0` branch always re-ran
  // dispatch(landingId()) - the CONFIGURED landing subsystem - instead
  // of Lesson Tracker specifically. That's the exact bug this fixes:
  // clicking the Lesson Tracker tab would silently re-render whatever
  // the landing subsystem currently was instead of Lesson Tracker,
  // including doing nothing visible if you were already on that landing
  // subsystem. Giving it a real, non-colliding hash (same as every
  // other subsystem already has) and an explicit dispatch branch in
  // route() (see app.js) fixes this the same generic way every other
  // subsystem is handled. '#/' itself still works and still means
  // "go to the landing subsystem" (used by the brand-logo click and the
  // post-setup redirect) - it's just no longer ALSO secretly Lesson
  // Tracker's own address.
  { id: 'lessons', label: 'Lesson Tracker', icon: '📚', hash: '#/lessons', hideable: true },
  { id: 'airdrop', label: 'AirDrop', icon: '⇄', hash: '#/airdrop', hideable: true },
  { id: 'schedule', label: 'Daily Schedule', icon: '📅', hash: '#/schedule', hideable: true },
  // v1.1.1: relabeled "Timers" -> "Clock" (id/hash left untouched on
  // purpose - see the "NEVER rename an existing id" note above; this is
  // just the display label). Clock now has 3 menus inside it (Timer /
  // Alarm / Stopwatch) - see public/js/timers.js. Still exactly ONE
  // subsystem, same as before - the 3 menus are internal navigation
  // within it, not 3 separate registry entries.
  { id: 'timers', label: 'Clock', icon: '🕐', hash: '#/timers', hideable: true },
  // v1.1.0: merged in from Part 1 - see public/js/ytdownload.js's
  // self-registration (window.DexSubsystems['ytdownload']) and
  // routes/ytdownload.js / lib/ytdownload-store.js for the rest of the
  // subsystem. Uses the generic window.DexSubsystems fallback in
  // app.js's route() - no special-casing needed there.
  { id: 'ytdownload', label: 'YouTube Downloader', icon: '⬇', hash: '#/ytdownload', hideable: true },
  // v1.1.5: new subsystem. Uses the generic window.DexSubsystems
  // fallback in app.js's route() - no special-casing needed there, same
  // as ytdownload above. See public/js/study.js self-registration and
  // routes/study.js / lib/study-store.js for the rest of it.
  { id: 'study', label: 'Study', icon: '📖', hash: '#/study', hideable: true },
  // v1.3.0: new subsystem, "the 2nd main layout" per the brief - but
  // registered as an ordinary subsystem tab like every other one here
  // (confirmed with the user rather than building it as a separate
  // full-screen mode with its own entry point). Uses the generic
  // window.DexSubsystems fallback in app.js's route() - no
  // special-casing needed there, same as ytdownload above. See
  // public/js/sbm.js for the rest of it.
  { id: 'sbm', label: 'Standby Mode', icon: '🌙', hash: '#/sbm', hideable: true },
  // v1.4.0: new subsystem. Uses the generic window.DexSubsystems
  // fallback in app.js's route() - no special-casing needed there, same
  // as ytdownload/sbm above. See public/js/todos.js, routes/todos.js,
  // lib/todos-store.js for the rest of it. Also feeds the Study
  // Calendar tab's day panel (done/scheduled lists + schedule form) and
  // Standby Mode's optional today's-to-do card.
  { id: 'todos', label: 'To-Do', icon: '✅', hash: '#/todos', hideable: true },
  // v1.6.0: new subsystem. Uses the generic window.DexSubsystems
  // fallback in app.js's route() - no special-casing needed there, same
  // as todos above. See public/js/cctv.js, routes/cctv.js,
  // lib/cctv-store.js for the rest of it. On a home LAN with a Hikvision
  // DVR, shows every camera's live feed with no login on the DEX Labs
  // side (credentials live in data/cctv.json, set once from Settings or
  // found automatically by discovery).
  { id: 'cctv', label: 'CCTV', icon: '📹', hash: '#/cctv', hideable: true },
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
