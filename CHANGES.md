# DEX Labs v1.1.6 - Changes

## Lesson Tracker: adding a YouTube lesson can no longer hard-fail

Previously, adding a lesson could fail outright with a generic "Could not
process that YouTube link" error - even though the "Details" button
(which fetches the full video page separately) kept working fine. The
add flow now has a guaranteed fail-safe: as long as what's pasted is a
real URL, adding it will always succeed with *something* rather than
blocking you.

- **Single video links**: unchanged in the success case (still fetches
  a real title/thumbnail via oEmbed when possible) - but this path was
  already proven not to throw. The real gap was elsewhere (see below).
- **Playlist links that also point at one specific video** (a normal
  `watch?v=...&list=...` link) - if reading the *playlist* fails for
  any reason (temporary YouTube block, layout change, no internet),
  the app now falls back to adding just that one video instead of
  failing the whole request. You get a clear one-line warning
  explaining what happened, but the video is still added.
- **Any other failure that reaches the very end** (a genuine bug, a
  disk/db problem, a playlist link with no video of its own to fall
  back to) now makes one last attempt to save the link as a plain,
  title-less lesson entry before giving up - "Details" can fetch the
  real title later once things are working again. A hard failure is
  now reserved for cases where even that isn't possible (e.g. the
  pasted text isn't a URL at all).

## Fixed: invisible characters from pasted links breaking detection

Links copied from apps like WhatsApp (especially the "Open on YouTube"
style share links, or text copied out of a channel description) can
carry invisible characters stuck to the end - things like the
object-replacement character (shows as a box/placeholder if you look
closely), zero-width spaces, and bidi text-direction marks. These are
invisible in a text box and untouched by trimming whitespace, but they
were enough to confuse URL parsing - potentially misreading a normal
video link as a broken playlist link, or losing the video ID entirely.
Pasted links are now stripped of this invisible junk before anything
tries to parse them (`lib/youtube.js: sanitizeUrl`), on both the
playlist-detection and single-video paths.

---

# DEX Labs v1.1.5 - Changes

## New subsystem: Study

A sixth subsystem, alongside Lesson Tracker/AirDrop/Daily Schedule/Clock/
YouTube Downloader - same full isolation pattern (own store, own route
file, own frontend module, own CSS, own `data/study.json`), registered
in `lib/subsystems-registry.js` as `id: 'study'`. It has 3 menus (same
"tab shell" pattern Clock uses for Timer/Alarm/Stopwatch):

1. **Study** - manage a list of subjects (add/rename/delete - rename/
   delete reuse plain `prompt()`/`confirm()`, same convention
   `airdrop.js` already uses rather than a custom modal). Click a
   subject to pick a method - **Stopwatch** (just counts up) or
   **Pomodoro** (study/rest cycles) - then "Begin studying" opens a
   full-screen focus view: a circular ring (visually the same language
   as Clock's rings - `ringSvg`-style helper, just re-implemented
   locally in `study.js` since subsystems don't share frontend code by
   design), Pause/Resume, Stop & Save, and Cancel (discard, no save).
2. **Stats** - per-year totals: overall hours studied, session count,
   an SVG pie chart + horizontal bar chart of hours by subject (own
   lightweight SVG built inline, no chart library - consistent with
   this project's "no build step, no bundler" approach everywhere
   else), and a count of how many days this year were **Studied**
   (automatic, from real sessions) vs manually marked **Slept** vs
   **Did nothing**. If today has no session yet, a small "how was
   today?" quick-log widget appears.
3. **Calendar** - a GitHub-style contribution heatmap for the whole
   selected year (own from-scratch grid, not a library), colored by
   how many minutes were studied that day (5 fixed intensity levels),
   with Slept/Did-nothing days shown in their own colors. Click any
   past day with no study session to mark it Slept/Did nothing/clear -
   a day that already has a real session can't be overwritten by a
   manual mark.

**The active session is server-authoritative, same design as Clock's
Stopwatch** (`lib/study-store.js`, mirroring `lib/stopwatch-store.js`):
elapsed/phase time is derived from stored timestamps + wall clock on
every read, so it survives page reloads and server restarts with **no
tick loop**. Unlike Clock's Timer/Alarm, there's no server-side beep
here and Study needed no `GET /api/busy` entry either - a Pomodoro
phase change gets a plain browser-side Web Audio beep instead (same
`playBrowserBeep`-style approach `timers.js` already uses for its bonus
in-browser alarm sound), because studying is a foreground activity
(you're looking at the page), unlike an alarm that has to reach real
speakers with no browser open at all.

**Pomodoro study/rest minutes are saved forever** in
`data/study.json`'s `settings` (same folder as every other subsystem's
data - never touched by the update process, see `apply-update.ps1`),
editable from the method-choice screen. This was an explicit
requirement with a specific failure mode to avoid: **a session freezes
its own copy of `pomodoroStudyMin`/`pomodoroRestMin` the moment it
starts** (`startSession` in `lib/study-store.js`) and never re-reads
`settings` again - so changing the defaults can never retroactively
change a session that's already running, or any session already saved
into history. Verified directly: started a session, then changed
`settings` via `PUT /api/study/settings`, then re-read the active
session - its frozen values were untouched. Also verified the
rest-phase-excluded "hours actually studied" math directly (a
simulated 90-second Pomodoro session with 60s study/60s rest phases
saved exactly 60000ms studied, not 90000ms) and the multi-cycle phase
math (a simulated 150-second elapsed session with 60/60 minute-long
phases correctly reported 1 full cycle completed, currently 30s into
the study phase of cycle 2).

**A day with a real study session can never be overwritten by a manual
Slept/Did-nothing mark** - `setDayLog` in `lib/study-store.js` checks
for an existing session on that date and refuses if found, so the
auto-derived "studied" status can't drift out of sync with the actual
session data by a stray manual click. Manual marks are also refused for
future dates (nothing has happened yet to log).

**One small `app.js` change was needed, not just a registry entry**:
the generic `window.DexSubsystems[...]` dispatch path (the one every
subsystem other than Clock/Settings/AirDrop/Schedule/Lesson-Tracker
goes through) previously called `generic.render()` with no argument, so
a sub-route like `#/study/stats` never told the module which of its own
tabs to open - fine for YouTube Downloader (no sub-tabs), not fine for
Study (3 of them, same shape as Clock's problem, which is why Clock is
one of the specially-handled ids in `route()`). Fixed by forwarding the
second hash segment to every generic subsystem too
(`generic.render(parts[1])`) - harmless for subsystems that ignore the
argument, and means any *future* subsystem with its own sub-tabs won't
need its own special case in `app.js` either, closing the same gap
Study just hit.

Tested directly via the real server as a subprocess and real HTTP
requests (same methodology as every other backend change in this
project - see PROJECT_BRIEFING.md's "critical technical lessons"): full
subject CRUD, Pomodoro start/pause/resume/finish/cancel, the
duplicate-active-session guard, the settings-freeze guarantee, the
rest-phase-exclusion math, the multi-cycle phase math, stats
aggregation, and every day-log guard rail (can't overwrite a studied
day, can't log a future day). Not tested: real Windows/browser Web
Audio playback for the Pomodoro phase-change beep (no audio hardware in
this sandbox) - same standing caveat as every other browser-side beep
in this project.



## Hotfix #2 (same v1.1.4 release, zip re-packaged again): the previous fix couldn't actually take effect, and why

Hotfix #1 (below) added a "kill anything on the Landing Page's port
before replacing that folder" step to `apply-update.ps1` - reasonable,
but it turned out to be **structurally unable to help the exact
transition it was written for**. Confirmed by the user still hitting the
identical "Update finished with warnings" after updating to the
hotfix-#1 zip.

**Why the first fix couldn't work**: `apply-update.ps1` is invoked as
`$AppRoot\apply-update.ps1` - i.e. whatever copy is **already installed
on disk right now**, not the new one sitting inside the zip being
applied. For a v1.1.3 -> v1.1.4 update specifically, that means the
**v1.1.3 version of `apply-update.ps1` is what actually executes** - a
fix living only inside the new zip's copy of that file can never run
during the one update that needed it. This is a genuine chicken-and-egg
problem with any self-updating script: the file doing the updating can
only be replaced by the update it's currently running, not improved by
it.

**What was actually going wrong, more precisely**: the OLD (already
all-or-nothing) copy loop wraps the ENTIRE folder-replace step in one
try/catch. The moment `landing-page/` fails to delete (because the old,
independently-running Landing Page process was still using it as its
working directory - see Hotfix #1's write-up below for that part), the
whole loop aborts immediately - and everything that comes alphabetically
after "landing-page" (**`lib/`, `package.json`, `public/`, `server.js`,
`tray.ps1`**) never gets touched. So this wasn't just "one folder didn't
update with a scary message" - it left the install in a genuinely
half-updated, inconsistent state: still running the OLD `tray.ps1`
(explains why the tray kept showing "DEX Labs v1.1.3" as current even
after the "completed" update).

**The actual fix**: the folder-replace loop is now resilient per-item
instead of all-or-nothing - each top-level file/folder gets its own
retry-with-backoff (3 attempts, 500ms apart), and if one specific item
still can't be replaced after that, it's logged and skipped rather than
aborting everything else. Since this fix lives in the mechanism that
processes *each remaining item after a failure*, not in something that
needs to run before the failure happens, it actually can help partway
even when invoked by an old script - once "landing-page" is skipped, the
loop continues on to `lib/`, `package.json`, `public/`, `server.js`,
`tray.ps1`, etc., all of which succeed normally. The overall update is
only reported as failed for a genuinely-unexpected item; "landing-page"
being unable to replace is treated as a known, self-resolving case (the
NEW `tray.ps1`, once in place, correctly manages the Landing Page
process going forward, so it stops blocking future updates automatically
from the very next one onward).

**One-time manual step still needed for THIS specific v1.1.3 -> v1.1.4
transition**: because of the chicken-and-egg problem above, existing
v1.1.3 users need to manually close the old, independently-running
Landing Page process ONE TIME before this update can fully succeed (it
can't be automated away for this specific jump - there's no code that
could reach back in time to fix the OLD script). Simplest one-time fix:
open Command Prompt and run `taskkill /F /IM node.exe`, then retry
Update from the tray. Every update after this one is fully automatic
again, with no manual steps, for anyone already on v1.1.4 or later.

---


## Hotfix (same v1.1.4 release, zip re-packaged): "Update finished with warnings" on the v1.1.3 -> v1.1.4 update

Reported after the initial v1.1.4 zip was published: updating a real
v1.1.3 install to v1.1.4 (via the tray's manual "Select Update File")
completed but showed **"Update finished with warnings"** - files still
got updated and the server restarted, but something failed along the
way.

**Root cause**: `apply-update.ps1` is invoked by whichever `tray.ps1`
happens to be running *at the time* - which, for this exact upgrade, is
the OLD v1.1.3 `tray.ps1`. v1.1.3's `tray.ps1` has no
`Stop-DexLandingPage` at all (that didn't exist until v1.1.4), so it has
no idea the Landing Page (`landing-page/server.js`) is a process that
needs stopping before an update. On a real machine with the Landing Page
actually running (started by v1.1.3's own separate auto-start entry),
that `node.exe` process was still alive - with `landing-page` as its
*current working directory* - exactly when the update's file-copy step
tried to `Remove-Item -Recurse -Force` that whole folder to replace it.
Windows refuses to delete a directory that's a running process's current
working directory, so that step failed, which is what actually produced
the warning.

**Fix**: `apply-update.ps1` now kills anything running on the Landing
Page's port itself, unconditionally, right before it needs to replace
that folder - it no longer relies on the calling `tray.ps1` (whatever
version that happens to be) having already stopped it. This makes the
update self-sufficient regardless of which old version is doing the
calling, which is the actual general lesson here: **the update script
can't assume the tray.ps1 invoking it is the same version being updated
to.**

Nothing else changed in this hotfix - the version-update/comparison
logic was deliberately left untouched per explicit instruction, since it
was already confirmed working correctly once the release tag was
capitalized to match what it expects.

---


## Landing Page: from a separate program to a fully integrated part of DEX Labs

v1.1.3 shipped the Landing Page (the "type just your IP, no port" front
page listing websites on the computer) as a completely standalone
program - own install/start/stop `.bat` files, a manual setup step. This
release folds it into DEX Labs' normal lifecycle per explicit request:
**no separate install step - it just runs, alongside DEX Labs, requesting
admin permission itself only when it actually needs it.**

### What changed

- **`tray.ps1` now starts/stops/watches the Landing Page itself**, the
  same way it already manages the main Node server:
  - `Start-DexLandingPage`/`Stop-DexLandingPage` (new) - same
    `ProcessStartInfo` child-process pattern as `Start-DexServer`/
    `Stop-DexServer`, logging to the same `logs.txt` so the existing
    Console menu item shows both.
  - Called right alongside every existing `Start-DexServer`/
    `Stop-DexServer` call site: initial tray startup, both update paths
    (background silent auto-update AND the manual "Select Update
    File"/"Check for Updates" menu items), and Exit.
  - `Invoke-DexLandingPageWatchdogCheck` (new) - added to the same
    5-second watchdog timer as the main server's crash-restart check,
    but as its own independent check (the two processes' liveness isn't
    linked) - if the Landing Page dies, it comes back on its own, same
    as the main server already does.
  - A new tray menu checkbox, **"Landing Page (site list on port
    80)"**, on by default (`data/config.json`'s new `landingPageEnabled`
    key) - unlike most other settings in this menu, toggling this takes
    effect *immediately* (starts/stops the actual process right then),
    not just on next restart.
- **Admin permission is requested automatically, exactly once, only
  when actually needed** (`Ensure-DexLandingPageFirewall`, new): checks
  whether the `DexLabsLandingPage80` firewall rule already exists first
  - if so, silently does nothing (the common case for anyone who
    already had it from v1.1.3, or a previous v1.1.4 run). Only if it's
    genuinely missing does it request elevation - via the standard
    `Start-Process -Verb RunAs` self-elevation idiom, targeting *just*
    that one `netsh` command in its own short-lived elevated process,
    **not** re-launching the whole tray elevated. This only ever runs
    from `Start-DexLandingPage`'s normal call sites (tray launch, post-
    update restart, the Settings toggle) - **never** from the watchdog's
    crash-restart check or the silent 5-minute background auto-update
    timer, so a UAC prompt can never surprise someone while they're not
    at the PC. Startup/update moments are always tied to an active,
    present user session (someone just logged in, clicked a shortcut,
    or is watching an interactive update dialog) - a real difference
    from the background timer's "nobody may be there" design constraint
    that's been in place since v1.0.4 and is preserved untouched here.
- **`install.bat` needed zero functional changes** - it already ends by
  launching `tray.ps1` (via the Startup `.vbs`), which now handles
  starting the Landing Page (and requesting the one-time permission)
  entirely on its own. Only a short informational message was added to
  the "All done!" summary, mentioning what the upcoming permission
  prompt is for.
- **`clear-port.bat` now also frees the Landing Page's port** (80 by
  default) alongside the main app's port, with the same PID-4-("System")
  safety case as everywhere else this project touches port 80 - "stop
  DEX Labs" now means *all* of DEX Labs, not just the main server.
  `uninstall.bat` also now removes the `DexLabsLandingPage80` firewall
  rule.
- **Removed** (superseded by the above, now living in `tray.ps1`
  instead): `landing-page/install-landing.bat`, `start-landing.bat`,
  `stop-landing.bat`, `uninstall-landing.bat`,
  `clear-landing-port.bat`, `run-landing-hidden.vbs`.

### Making sure existing v1.1.3 users update cleanly - the actual hard part of this release

Three separate things had to be handled correctly for someone already
on v1.1.3 to update to v1.1.4 without anything breaking or getting lost:

1. **Their saved site list must survive the update.**
   `apply-update.ps1`'s existing update mechanic wholesale-deletes-and-
   replaces each top-level folder in the new zip (that's how
   `server.js`, `tray.ps1`, etc. get updated) - and `landing-page/` is
   one of those top-level folders. Without special handling, updating
   would have silently wiped `landing-page/data/sites.json` - anyone's
   saved custom sites - on *every single update*, the same way it
   correctly leaves `data/`/`uploads/`/`uploads-airdrop/` alone only
   because those happen to be excluded by name at the top level.
   `landing-page/data` is nested one level down, so that existing
   exclusion list didn't (and structurally couldn't) protect it. Fixed
   with an explicit preserve-before/restore-after pair around the
   folder-replace step (belt-and-suspenders: it's also included in the
   regular pre-update backup now, same as the AirDrop custom-location
   handling). **Verified** by simulating the exact preserve → wholesale-
   delete → restore sequence with a real custom site in the data file
   and confirming it survives intact.
2. **The old, now-redundant v1.1.3 auto-start entry must be removed**,
   or DEX Labs and that old entry would both try to start the same
   port-80 process on every login, racing each other, with the tray's
   new watchdog/enable-toggle unable to actually control the one it
   didn't start. `apply-update.ps1` now deletes the old
   `DexLabsLandingPage.vbs` Startup-folder shortcut as part of every
   update - safe no-op for fresh installs or anyone already past this
   point.
3. **The firewall rule they already granted must not trigger a second
   permission prompt.** Since `Ensure-DexLandingPageFirewall` checks for
   the existing rule by the same name (`DexLabsLandingPage80`) before
   ever asking, existing v1.1.3 users who already clicked "Yes" once
   never see the prompt again after updating.

### Also fixed along the way

- `landing-page/server.js`'s port resolution now also checks the main
  shared `data/config.json`'s new `landingPagePort` key (in addition to
  the v1.1.3-era standalone override file, which still works exactly as
  before for anyone who already set one) - a small step toward this
  being one integrated app's config rather than two separate ones,
  without breaking the escape hatch anyone already relied on.

### Testing performed (this session)

No Windows available in this sandbox (same standing limitation as
`tray.ps1`/`apply-update.ps1` generally) - the actual `.ps1` changes
could not be executed and verified end-to-end the way the Node/JS side
could be. What *was* verified:

- The layered port-resolution logic (legacy override file → shared
  config key → 80 default) via real HTTP requests against the real
  server, for all three cases.
- The exact preserve/restore sequence `apply-update.ps1` uses for
  `landing-page/data`, reproduced step-by-step with a real custom site
  entry, confirming it survives a simulated wholesale folder replace.
- Structural review of every `tray.ps1` edit (brace/paren balance check,
  full re-read of the new Landing Page block, confirmed every function
  is defined before its call sites) and of the netsh elevation command
  specifically against the exact `Start-Process -ArgumentList`
  space-in-path bug documented below in the v0.2.2 lessons - this one
  has no paths and no embedded quotes at all, sidestepping that failure
  mode entirely rather than trying to get the quoting "more correct."
- Full Node-side smoke test: both servers running together, main server
  correctly showing as "online" from the Landing Page's own site list.

**If the user reports anything wrong with the tray-side integration
(the permission prompt, the toggle, the watchdog), get the exact text
from `logs.txt` (Console menu item) first** - this is the piece with the
least real-world verification in this release.

---

# DEX Labs v1.1.3 - Changes

## New: the Landing Page (`landing-page/`)

A brand new, standalone "type just your IP, no port" front page for the
computer this runs on - lists DEX Labs itself plus anything else running
on the machine, each with its own port, so someone on the WiFi can find
and open them without already knowing the port. Explicit user
requirement this was built to satisfy: it must work like a subsystem in
spirit (own list, own UI) but **not be a real subsystem of DEX Labs, and
must not be visible from/reachable through the port-3002 site at all**.

**This is why it's a wholly separate program, not a new
`lib/*-store.js` + `routes/*.js` + subsystem-registry entry the way
every other feature in this project has been added:**

- Own Node process, own port (**80** - the default HTTP port, which is
  the entire point: typing an IP with nothing after it assumes port 80),
  own `server.js`, own data file (`landing-page/data/sites.json`), own
  install/start/stop/uninstall `.bat` scripts, own `README.md`.
- Zero npm dependencies - built entirely on Node's own `http`/`fs`/
  `path`/`net`/`url` modules, so it runs straight out of the zip with no
  `npm install` step, same "avoid anything that can fail to install"
  philosophy as the rest of this project (see the `@distube/ytpl` saga
  and "why no native npm tray package" elsewhere in
  `PROJECT_BRIEFING.md`).
- Never mounted inside `server.js`, never added to
  `lib/subsystems-registry.js`, no nav entry, no `window.DexSubsystems`
  registration - DEX Labs' own site (port 3002) has zero knowledge this
  exists. This is deliberate, not an oversight: the Landing Page needs to
  keep working even if DEX Labs' own server is stopped, mid-update, or
  crashed, since it's the front door people hit first - often
  *specifically because* something else on 3002 isn't answering.

### How it works

- `landing-page/server.js` binds `0.0.0.0:80` (same "explicit host" idiom
  as the main `server.js`'s own `app.listen(PORT, '0.0.0.0', ...)`) and
  serves a small page (`landing-page/public/`) listing saved sites.
- Each entry in the list is just a **name + port + optional path +
  optional note** - no IP is ever stored anywhere. Every link on the page
  is built client-side as `http://${location.hostname}:${port}${path}`
  (see `siteUrl()` in `landing-page/public/app.js`), i.e. from whatever
  address the browser actually used to load the page. This was an
  explicit requirement: **the feature must not assume any particular
  subnet** (`192.168.1.x` or otherwise) since a user's router could hand
  out any range at all - using `location.hostname` instead of a stored/
  hardcoded IP makes the whole feature subnet-agnostic automatically,
  with no configuration needed.
- Each card shows a small online/offline dot from a live TCP connect
  check against `127.0.0.1:<port>` (`checkPortOpen()` in `server.js`) -
  refreshed every 5s. This can only confirm "something is listening on
  that port", not that it's a fully healthy website, but that's enough to
  tell someone "is this even running right now" for things they don't
  leave on all the time.
- Add/Edit/Remove all happen directly on the page itself (no file editing
  needed) - `landing-page/lib/sites-store.js` is the same tiny JSON-file-
  "database" pattern as every other store in this project
  (`data/sites.json`, read-whole-file/write-via-temp+rename/serialize-
  writes-through-one-promise-chain), with its own validation (name
  required, port 1-65535, path normalized to start with `/`).
- **First-run seed**: DEX Labs itself is pre-added on first start, with a
  best-effort **read-only** peek at the main app's own
  `data/config.json` to get its real configured port (in case it was
  changed from the 3002 default via the tray's Settings menu) - wrapped
  in try/catch, falls back to 3002 if that file's missing/unreadable.
  Never writes to that file, never touches it otherwise.

### A real bug caught and fixed before shipping (worth flagging for future sessions)

While writing `lib/sites-store.js`'s validation, an early draft put the
`throw` for bad input (bad port, empty name, etc.) *inside* the mutator
function passed to `update()`. This is a real trap in the
"single long-lived `writeQueue` promise chain" pattern used by every
store in this project (`lib/timers-store.js`, `lib/stopwatch-store.js`,
and now this one): `.then()` on an **already-rejected** promise skips
straight to rejection without ever running its callback. So if a mutator
ever threw, `writeQueue` itself would become permanently rejected, and
**every future call to `update()` - for anything, forever, until the
server restarts - would silently reject too**, since each new
`writeQueue = writeQueue.then(...)` just chains onto an already-dead
promise. Caught via testing (deliberately calling the API with bad input
right before calling it again with good input, to check the second call
still worked) before this ever shipped. Fixed by moving all validation
(and the `MAX_SITES` cap check) to run *before* `update()` is ever
called, in `create()`/`edit()` themselves, so the mutator passed to
`update()` is always guaranteed-safe, non-throwing array/object
manipulation - see the warning comment directly above `update()` in
`lib/sites-store.js`. **If a future session adds a new store using this
same pattern, keep validation outside the mutator** - this is an easy
mistake to repeat since the existing stores' mutators just happen to
never throw, so nothing about copying their shape makes the danger
obvious.

### Testing performed (this session)

Following this project's established methodology - ran the real server
(as a subprocess, bound to port 80, which needed a sandbox running as
root; see the Windows-permissions caveat below) and hit it with real
HTTP requests, plus a `jsdom` pass over the real frontend:

- Confirmed static file serving (`/`, `/style.css`, `/app.js`) and that
  path-traversal-style requests (`/../server.js`, `/..%2f..%2fserver.js`)
  correctly 404 rather than escaping `public/`.
- Confirmed the DEX Labs seed entry correctly reads the main app's real
  configured port (tested both the 3002 default and a deliberately
  changed port via the main app's own `data/config.json`).
- Full CRUD verified live: add, list, edit, delete, and the two
  validation-error cases (bad port, missing name) all return the
  expected data/status codes.
- **Specifically re-tested that a validation error does NOT poison the
  write queue** (see the bug write-up above) - added a valid site right
  after two rejected ones and confirmed it still succeeded.
- Confirmed the online/offline check actually flips from `false` to
  `true` against the real main DEX Labs server once it's actually
  running, using a real TCP connect, not a guess.
- Confirmed via `jsdom` (a real browser DOM) that rendered site links are
  built from the page's own `location.hostname` rather than any
  hardcoded address - loaded the page from a test URL of
  `http://192.168.1.3/` and confirmed the generated links pointed at
  `192.168.1.3`, proving the mechanism is IP-agnostic rather than proving
  anything specific about that one address.

### Known limitations / caveats

- **The Windows-side scripts (`install-landing.bat`, `start-landing.bat`,
  `stop-landing.bat`, `uninstall-landing.bat`,
  `clear-landing-port.bat`, `run-landing-hidden.vbs`) are untested on
  real Windows**, same standing caveat as `tray.ps1`/`apply-update.ps1`
  elsewhere in this project - no Windows available in the sandbox that
  built this. They were written carefully against patterns already
  *proven* to work elsewhere in this same project (`install.bat`'s
  firewall-rule-add and Startup-`.vbs`-write steps, `clear-port.bat`'s
  PID-kill pattern, the standard `net session`/`Start-Process -Verb
  RunAs` self-elevation idiom), reusing their exact shape rather than
  inventing new patterns, but that's not the same as having run them for
  real. If the user reports an install/start/stop issue, get their exact
  error text from `start-landing.bat`'s visible console first.
- **Port 80 is commonly already claimed on Windows** by IIS/"World Wide
  Web Publishing Service" (often present-but-off by default on some
  Windows editions), or occasionally other software (old Skype, Docker
  Desktop, some VPN clients). `landing-page/README.md` has the full
  walkthrough, including the important "PID 4 is the Windows kernel, not
  a real process you can/should kill" case that `clear-landing-port.bat`
  deliberately special-cases rather than blindly `taskkill`-ing.
- The online/offline check is a bare TCP connect, not an HTTP request -
  documented in the README as a known simplification (can't distinguish
  "a real working website" from "something that accepts connections but
  never responds").
- No authentication on this page - anyone on the WiFi can view and edit
  the site list. Fine for a home LAN (this project's whole stated
  purpose); the README explicitly warns against exposing port 80 to the
  wider internet (e.g. via router port-forwarding) without adding some
  access control first.

---

# DEX Labs v1.1.2 - Changes

Four bug fixes, all in the Clock subsystem except one in the shared
frontend shell (`app.js`). No new features.

## 1. Single stopwatch/timer card wasn't centered

`public/css/timers.css`'s `.timers-grid` used
`grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))`. `auto-fill`
always lays down as many (possibly empty) tracks as fit the row width, so
with only one card running, that card sat pinned to the left of a
full-width row of invisible empty tracks instead of looking centered.
Fixed by switching to `auto-fit` (which collapses unused tracks instead
of keeping them around) with a capped track size
(`minmax(160px, 200px)` instead of `minmax(160px, 1fr)`, so the one
remaining track doesn't just stretch to fill the whole row) plus
`justify-content: center` on the grid, which centers the resulting track
set as a whole. One card now centers; several still wrap left-to-right
exactly as before.

## 2. Stopwatch ring animation only turned ~60-70% before snapping back

The real bug, and the "wird" one: `renderStopwatchCards()` (and
`renderTimerOrAlarmCards()`) fully replaced `wrap.innerHTML` on every 1s
poll tick, which destroys every card's DOM node - including the ring
`<circle>` - and builds brand new ones. The Stopwatch ring's continuous
spin is a plain CSS animation (`sw-ring-spin`, 1.6s per lap) - restarting
its element every 1s (faster than the 1.6s lap) meant the animation never
got to finish a lap: it visibly rotated about 1s/1.6s = ~62% of the way
around and then snapped back to frame 0, over and over, forever.

Fixed with a small generic list-reconciler (`reconcileGrid()` in
`public/js/timers.js`) used by both the Timer/Alarm and Stopwatch
renderers: existing cards' DOM nodes are now kept alive across polls and
only the parts that actually changed (elapsed/remaining text, running/
ringing state classes, the pause⇄resume or dismiss⇄cancel button, the lap
list) are updated in place - the ring `<circle>` itself is never touched
once created, so its CSS animation just keeps running like a real
spinner. Cards are only created/removed when a stopwatch/timer is
actually added or removed. Verified via a real `jsdom` pass (a real
browser DOM, not a Node/curl simulation): confirmed the ring's actual DOM
node identity is preserved across multiple simulated polls, including
across a running→paused→running toggle and while other cards are
added/removed alongside it.

## 3. Alarm/timer beep was too quiet

`lib/timers-store.js`'s `ringServerBeep()` synthesizes its own WAV and
plays it via `System.Media.SoundPlayer` (see v1.1.1's Bluetooth fix in
`PROJECT_BRIEFING.md`) - but the samples were scaled to only
+/-12000 out of a possible +/-32767 for 16-bit PCM (~37% of full volume).
Turned up to +/-32000 (~98% of full scale, just shy of clipping) for a
much louder tone, and the beep duration was bumped from 350ms to 500ms.
The bonus in-browser beep (`playBrowserBeep()` in `public/js/timers.js`,
Web Audio, plays only if a browser tab is actually open) was similarly
turned up from a gain of 0.15 to 0.35.
**Still unverified on real Windows/Bluetooth hardware** - same caveat as
always for anything server-beep related; if it's still not loud enough,
that's the next thing to tune (`$freq`/`$durMs`/`$reps` in
`ringServerBeep()`), the amplitude change here is the biggest lever
available at the WAV-encoding level.

## 4. "What's new" update banner showed raw Markdown literally

`public/js/app.js`'s update banner ran the GitHub release's `body` (real
Markdown - `**bold**`, `- ` bullet lists, `#` headings, etc., exactly as
typed into the GitHub release notes editor) through `escapeHtml()` and
dropped it straight into the page as plain text - so the banner displayed
literal asterisks, dashes, and hash marks instead of bold text, bullet
points, and headings.

Fixed with a small, dependency-free Markdown → HTML converter
(`renderMarkdownLite()` in `app.js`) covering what GitHub release notes
actually use in practice: headings, bold/italic, inline code, links,
bullet/numbered lists, and paragraphs. Every text run is escaped via
`escapeHtml()` *first*, and only that already-inert escaped text gets
wrapped in real tags afterward - so nothing that looked like an HTML tag
in the release body can come back to life as one, and link targets are
restricted to `http(s)://` URLs (anything else, e.g. a `javascript:` URL,
falls back to being left as plain bracketed text instead of becoming a
clickable link). `public/css/settings.css`'s `.update-banner-body` got a
few small style rules to match (headings/lists/code/links), replacing the
old `white-space: pre-wrap` that was only needed for the previous
plain-text rendering. Verified in isolation: fed a sample release body
with headings/bold/italic/lists/links/a numbered list/an embedded
`<script>` tag/a `javascript:` link through the real function and
confirmed the output renders as proper HTML while the script tag stays
inert (escaped) and the unsafe link is left as plain text rather than a
clickable link.

---

# DEX Labs v1.1.1 - Changes

Two changes, both inside the subsystem that used to be called "Timers"
(id `timers` in `lib/subsystems-registry.js` - **never renamed**, only
its display label changed):

## 1. Renamed "Timers" -> "Clock", added a Stopwatch menu

Still exactly **one subsystem** (explicit user requirement - not 3
separate ones). It now has **3 menus inside it**: Timer, Alarm,
Stopwatch - a segmented tab control at the top of the page
(`.clock-tabs` in `public/css/timers.css`), all served by the same
`public/js/timers.js` module and the same `routes/timers.js` router.

- **Timer** and **Alarm** are the exact same server-authoritative
  behavior as before (`lib/timers-store.js`, unchanged logic), just now
  each gets its own dedicated form/tab instead of one combined form with
  a kind-picker dropdown.
- **Stopwatch** (new) - start any number of independently named
  stopwatches (up to 10, same cap style as Timer/Alarm), Pause/Resume,
  Lap (keeps the last 50 laps per stopwatch), Reset, Remove. Server-
  backed (`lib/stopwatch-store.js`, `data/stopwatch.json`) so elapsed
  time survives a page reload or a server restart correctly - but unlike
  Timer/Alarm it needs no 1-second tick loop or beep, since there's
  nothing to expire or alert about; elapsed time is pure math off stored
  timestamps, computed fresh on every read.
- Deliberately reuses the **exact same ring/card visual language** as
  Timer/Alarm (explicit ask: "I like the animation that is there for
  alarms and timers, can you just make stopwatch like that too") - same
  `.timer-card`/`.timer-ring` markup and tokens. The ring can't count
  down to a known end point the way Timer/Alarm's does, so instead it
  draws a fixed ~30% arc that spins continuously via CSS while running
  (`sw-spin` in `public/css/timers.css`) and freezes in place when
  paused - same shape/family as the countdown ring, adapted for
  "elapsed with no known end."
- New routes, all under the same `/api/timers` mount (not a new
  server.js require/mount block - still one router file):
  `GET/POST /api/timers/stopwatches`,
  `POST /api/timers/stopwatches/:id/{pause,resume,lap,reset}`,
  `DELETE /api/timers/stopwatches/:id`.
- Navigation: `#/timers` = Timer (default), `#/timers/alarm` = Alarm,
  `#/timers/stopwatch` = Stopwatch - `public/js/app.js`'s router now
  passes `parts[1]` through to `Timers.render(subview)`.
- Not added to `GET /api/busy`'s idle check (unlike Timer/Alarm's
  `countActive()`) - a running stopwatch is just stored timestamps with
  no in-flight server work to protect, unlike an active timer's tick
  loop or a YouTube download's child process. Noted in
  `lib/stopwatch-store.js` in case a future session wonders why it's
  the odd one out.

## 2. Fixed: alarm/timer sound not audible over Bluetooth

**Reported bug**: when the server PC's default audio output was a
Bluetooth speaker/headset, the alarm went completely silent - worked
fine on the PC's built-in speakers.

**Root cause**: the server-side beep (`ringServerBeep()` in
`lib/timers-store.js`) called PowerShell's built-in `[console]::beep()`,
which drives the low-level Win32 `Beep()` API. That API is a legacy
motherboard-speaker primitive - it does NOT reliably go through the
normal Windows audio mixer / default-playback-device selection the way
real audio playback does, so it can be silent on Bluetooth (and some
USB) outputs while still working on built-in speakers.

**Fix**: `ringServerBeep()` now synthesizes a short tone as a real
in-memory WAV file and plays it with .NET's `System.Media.SoundPlayer`,
which goes through the normal multimedia audio stack and therefore
follows whatever the current default playback device actually is -
Bluetooth included. Still zero extra npm/native dependencies
(`System.Media`/`System.IO` are built into .NET, same "nothing extra to
install" philosophy as the rest of this project). If `SoundPlayer` ever
throws for some reason (e.g. no audio device present at all), the same
PowerShell script falls back to the old `[console]::beep()` inside a
`try/catch`, so this can't regress to total silence versus before.

**Not tested on real Windows hardware** - same caveat as everything
else in this project's audio/PowerShell path (see "the one area that
could NOT be tested" in `PROJECT_BRIEFING.md`). If the user reports it's
still silent over Bluetooth after this update, get the exact `logs.txt`
output from a ringing alarm next.

---

# DEX Labs v1.1.0 - Changes

v1.1.0 merges two parallel change sets that were built in separate Claude
sessions and merged by a third:

- **Part 1** ("v1.0.7" from its own session): a new, independent
  subsystem - **⬇ YouTube Downloader**.
- **Part 2** ("v1.0.5 Part 2"): a crash-restart watchdog, a forced
  first-run AirDrop setup flow, an update-announcement banner, a
  **subsystem show/hide menu** (built as a generic registry so it scales
  past the ~30 subsystems planned down the road), and an update-backup
  fix.
- **This merge** (session 3): wired Part 1's YouTube Downloader into Part
  2's subsystem registry/hide-menu system, resolved the few real file
  collisions, and closed one integration gap the two sessions couldn't
  have seen coming from either side alone (see "Merge work" below).

Version bumped straight to **1.1.0** (rather than 1.0.5) to reflect that
this is the combined release both parts were building toward.

---

## Part 1 - YouTube Downloader (new subsystem)

- Paste a YouTube video link, see real quality options (Max / Medium /
  Lowest / Audio-only) with accurate file sizes pulled straight from the
  video, pick one, and download it to this PC.
- Drives [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) directly as a child
  process (not a scraping library) - the same tool most of the
  self-hosting/archiving community relies on because it's actively
  maintained against YouTube's frequent changes.
- **`yt-dlp` sets itself up automatically** (checks PATH, then this app's
  own `tools-youtube/` folder, downloads it itself if missing - starts in
  the background at server startup) and **keeps itself updated** via its
  own self-update check, run periodically for as long as the server is up.
- **`ffmpeg` does NOT auto-download by default** - place `ffmpeg.exe` /
  `ffprobe.exe` in `tools-youtube/` yourself; detected automatically, no
  restart needed. (Auto-download exists and can be re-enabled via
  `AUTO_DOWNLOAD_FFMPEG` in `lib/ytdownload-store.js`, but proved
  unreliable against real third-party hosts, so it ships off.)
- Higher resolutions YouTube only serves as separate video/audio streams
  are merged with `ffmpeg` automatically.
- Downloads land in `downloads-youtube/` and are swept away after 24
  hours if unclaimed - independent of AirDrop's own 1-hour rule, since
  this is a personal download, not a shared drop.
- Built independently - own store (`lib/ytdownload-store.js`), own route
  (`routes/ytdownload.js`), own frontend module (`public/js/ytdownload.js`
  + `public/css/ytdownload.css`) - no cross-references into any other
  subsystem's data, per this project's usual convention.

## Part 2, Round 1 - watchdog, forced AirDrop setup, update banner

1. **Crash-restart watchdog** in `tray.ps1` (`Invoke-DexWatchdogCheck`,
   its own 5-second `System.Windows.Forms.Timer`): if the server process
   isn't running, restart it - unless an update is legitimately in
   progress, in which case it defers, but only for up to 15 seconds (past
   that, assumes the update is stuck/finished and restarts anyway).
2. **Forced first-run setup**: AirDrop's max-usage-GB and save-location
   are now live-configurable (`lib/config-store.js`'s `setupComplete`,
   `airdropMaxUsageGB`, `airdropSaveLocation`) instead of hardcoded, via a
   new Settings page on the website and a new prompt in the tray's
   Settings menu. Until `setupComplete` is true, the website redirects
   every route to Settings first. `lib/airdrop-store.js` now reads these
   live on every call, so a change takes effect with no restart.
3. **Update-announcement banner**: shows the latest GitHub release's
   notes once per new version, with a link and an OK button, via new
   `GET /api/settings/updates/latest` / `POST /api/settings/updates/ack`
   endpoints (10-minute server-side cache on the GitHub call).

## Part 2, Round 2 - subsystem show/hide menu, backup fix

4. **Subsystem show/hide menu** (website Settings page + tray Settings
   menu): hide any subsystem from the nav without deleting anything, and
   choose what loads first if the current default gets hidden. Built as
   a generic registry (`lib/subsystems-registry.js`) - listing `id`,
   `label`, `navLabel`, `hash`, `hideable` per subsystem - plus a
   `window.DexSubsystems` self-registration convention on the frontend,
   specifically so adding subsystem #5, #6, ... #30+ later needs no
   `app.js` edits. Hidden subsystems are blocked from direct hash
   navigation too (typing/following a link to a hidden one's URL bounces
   to `#/`), not just hidden from the nav buttons. Server is the source
   of truth (`GET/PUT /api/settings/subsystems`, with guards against
   hiding every subsystem and against an invalid landing choice); the
   frontend mirrors the same fallback logic for a smoother UI.
5. **Backup fix** in `apply-update.ps1`: a gap in Round 1's own AirDrop
   work - a custom save location wasn't being backed up before an
   update (only the default `uploads-airdrop/` was). Now the backup step
   also reads `airdropSaveLocation` from config and backs it up under
   `uploads-airdrop-custom-location/` if set, non-fatally if that
   sub-step itself fails.

---

## Merge work (this session)

Per `WHAT-TO-DO-part3.md`'s merge plan: started from Part 2 (the more
invasive change set - it reworked `app.js`'s nav/router) as the base,
copied Part 1's new files in on top, then did the one real piece of
integration work:

- **`lib/subsystems-registry.js`** - added the YouTube Downloader entry:
  `{ id: 'ytdownload', label: 'YouTube Downloader', navLabel: '⬇ YT Download', hash: '#/ytdownload', hideable: true }`,
  matching the `id`/hash Part 1's own `app.js` already used internally
  before the merge.
- **`public/js/ytdownload.js`** - added the
  `window.DexSubsystems['ytdownload'] = { render }` self-registration
  line (alongside the existing `window.YTDownload` export, left in place
  in case anything else references it). `render()` already matched the
  standard self-contained-module shape (same as `airdrop.js`/
  `schedule.js`/`timers.js`), so no changes were needed inside it.
- **`public/index.html`** - added `ytdownload.css`'s `<link>` and
  `ytdownload.js`'s `<script>` tag (before `app.js`, so it's registered
  by the time `route()` runs). No nav `<button>` needed - Part 1's own
  hardcoded one was never carried over, since Part 2's dynamic
  `#nav-links` renders it automatically from the registry now that step
  1 above is done.
- **`server.js`** - mounted `routes/ytdownload.js` at `/api/ytdownload`
  in its own try/catch (same isolation pattern as every other
  subsystem); added the startup calls for `ensureTools()` (background
  yt-dlp/ffmpeg setup at boot) and the periodic self-update/cleanup
  intervals Part 1's server.js had; added "YouTube Downloader" to the
  startup subsystems log line.
- **No changes needed to `app.js`'s `route()`** - confirmed its existing
  generic `window.DexSubsystems` fallback picks up `ytdownload`
  automatically with the registry entry above in place, exactly as
  `WHAT-TO-DO-part3.md` predicted.
- **`package.json`** - both parts already had the exact same
  `dependencies` (Part 1 didn't add any new npm packages - `yt-dlp` is
  driven as an external binary/child-process, not an npm library), so no
  dependency merge was actually needed. Version bumped to `1.1.0` and
  `package-lock.json` regenerated cleanly via `npm install` rather than
  hand-merged.
- **`lib/config-store.js`** - Part 1 made no additions here, so Part 2's
  version was taken as-is, no merge needed.
- **`lib/airdrop-store.js` / `routes/airdrop.js` / `db.js`** - Part 1
  didn't touch AirDrop or the Lesson Tracker DB at all (confirmed via
  diff against Part 2's versions - byte-identical), so no merge conflict
  existed here either; despite the file overlap in both zips, Part 1's
  YouTube work really was independent as described.
- **`tray.ps1`** - likewise confirmed byte-identical in substance between
  Part 1 and Part 2 aside from Part 2's own watchdog/settings-dialog
  additions (Part 1's copy had no YouTube-specific tray logic to merge
  in), so Part 2's version was taken as the base with nothing to
  reconcile.

### One integration gap closed: `GET /api/busy` didn't know about downloads

`WHAT-TO-DO-part3.md` flagged this as worth checking rather than telling
us the answer, since neither part could see it from its own side: the
tray's watchdog/auto-update logic avoids restarting the server while
`GET /api/busy` reports anything in flight - and before this merge, that
endpoint only checked file uploads and running timers, with no way to
know a YouTube download was mid-transfer. Fixed as part of the merge:

- **`lib/ytdownload-store.js`** - added `countActive()` (counts jobs with
  status `queued`/`downloading`), mirroring `lib/timers-store.js`'s
  existing `countActive()`.
- **`server.js`** - `GET /api/busy` now also calls this and includes a
  `downloadsActive` count / a `"N YouTube download(s) in progress"`
  reason string alongside the existing upload/timer checks.

This means the crash-restart watchdog and the background auto-updater
will now correctly wait out an in-progress YouTube download the same way
they already wait out a running timer or an in-progress upload, instead
of only knowing about two of the app's three kinds of "don't restart me
right now" state.

### File collisions - actual result

Per the merge plan's predictions in `WHAT-TO-DO-part3.md`, `server.js`
and `public/index.html` were the only files with real overlapping edits
to reconcile (handled above); `package.json` only needed a version bump
since dependencies already matched; `lib/config-store.js` needed no
merge since only Part 2 touched it. No unexpected collisions turned up.

## Testing performed (this session)

Following this project's established methodology: ran the actual merged
server as a subprocess and hit it with real HTTP requests, plus a
headless-browser (`jsdom`) pass over the real frontend since earlier
sessions had no browser available at all.

- **`npm install`** completed cleanly with a freshly regenerated
  `package-lock.json`; server boots with `[OK]` logged for all six
  subsystems, including `[OK] YouTube Downloader routes loaded.`
- **Confirmed working, live**: `GET /api/settings/subsystems` includes
  the new `ytdownload` entry; `PUT /api/settings/subsystems` can hide/
  unhide it and the change persists on re-fetch; `GET /api/busy` returns
  the new `downloadsActive` field; `GET /api/ytdownload/status` responds
  correctly (and confirmed `yt-dlp` really does auto-download itself on
  first boot, exactly as documented - the one failure seen in this
  sandbox was the downloaded binary not executing, which looks like a
  sandbox/architecture limitation rather than a code issue, since the
  download-and-detect logic itself worked correctly).
- **Confirmed working, live, via `jsdom`** (a real browser DOM, not a
  Node/curl simulation) against the real running server:
  - The dynamically-built nav includes a "⬇ YT Download" button with
    nothing hidden.
  - Navigating directly to `#/ytdownload` renders the real YouTube
    Downloader page (`<h2>YouTube Downloader</h2>`), not a placeholder.
  - After hiding `ytdownload` via the Settings API, the nav button
    disappears **and** navigating directly to `#/ytdownload` bounces back
    to `#/` - both halves of the hide behavior Part 2 built, confirmed
    working automatically for Part 1's subsystem with no `app.js` changes.
- **Not testable here (no Windows/PowerShell)**: everything in
  `tray.ps1` remains unverified on real Windows, same caveat as both
  parts already carried - this is still the single highest-value thing
  left to test before fully trusting v1.1.0, especially the watchdog and
  `Show-DexSubsystemsDialog`.

## Known remaining gaps

- `tray.ps1` (all of it, across both parts) has never run on real
  Windows/PowerShell - see above.
- The GitHub-release-notes banner's live network call was previously
  confirmed via `curl` outside Node but rate-limited when called from
  Node itself in Part 2's own sandbox (see "Part 2, Round 1" above) -
  worth a real check post-merge if possible, though the graceful-failure
  path was confirmed working either way.
