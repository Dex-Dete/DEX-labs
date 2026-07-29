# DEX Labs v1.3.5 - Changes

Four things, all user-requested:

**1. Icon/name nav toggle moved into Settings > Navigation.** It was
cluttering the topbar for a setting most people flip once and forget.
Same mechanism as before (a class on `<body>`, see `applyNavMode()` in
`app.js`) - just controlled from `window.DexNavMode.set()`/`.get()` so
Settings' switch can drive it instead of a control living in the nav
itself.

**2. Day/night mode is now an actual toggle switch in the header**
instead of a single button whose icon silently swapped between 🌙 and
☀. Sun and moon bookend the switch so it's obvious which state you're
in without reading a glyph.

**3. Study subject names (and stat values, the active tab, heatmap)
were unreadable in dark mode** - `--study-accent-dark` (and
`--rec-accent-dark`) are deep, near-black purples chosen for contrast
against a *light* card, and study.css never had a
`html[data-theme="dark"]` override block flipping them lighter the way
every other subsystem's CSS already does. Added one. While in there,
also caught and fixed a side-effect: the heatmap's darkest/"most
active" cell was reusing that same token for its *background* (not
text), so once the token flipped lighter for dark mode, level 4 started
rendering lighter than levels 2-3 - inverting the intensity gradient.
Split that into its own fixed, always-dark decorative token
(`--study-heat-4`) so the heatmap's color scale stays correct in both
themes, independent of the text-contrast fix.

**4. Mobile nav: subsystem buttons are now a compact grid of square
icon tiles** instead of one full-width row per subsystem, and the LAN
address button + day/night switch now sit in their own group below the
icon grid instead of mixed in with it. Falls back to the old stacked
list automatically in name mode, since full subsystem names need more
width than a square tile has.

# DEX Labs v1.3.4 - Changes

Two bug fixes, both reported directly by the user with a screenshot.

**1. Dark mode: mobile nav menu was unreadable.** The slide-out subsystem
menu (`.subsystem-nav` on phone widths) used `background: var(--ink)`,
and `--ink` is one of the tokens that *flips* between light mode's
`:root` block and dark mode's `html[data-theme="dark"]` override. In
light mode that gave a dark navy panel, which was correct - but in dark
mode `--ink` becomes near-white, while the menu's own link text
(`.nav-link`, `.icon-btn`) is colored with `--topbar-fg`, which is a
*fixed* light cream that never flips. Result: near-white text on a
near-white panel in dark mode - functionally invisible. Same root cause
hit `.nav-link.active`, which used `var(--ink)` for its text color
against the gold `--highlight` pill background (also low-contrast once
`--ink` goes light). Both now use `--topbar-bg`, the fixed dark-navy
token already introduced in v1.3.1 specifically so the header chrome
doesn't get flipped by the theme toggle - see the `--topbar-bg`/
`--topbar-fg` comment block near the top of `style.css`. **If a future
session adds more chrome that must stay legible across both themes
(nav panels, menus, anything meant to look like "the header"), use
`--topbar-bg`/`--topbar-fg`, not `--ink`/`--paper` - those two swap by
design everywhere else on the page.**

**2. Stopwatch rings (Clock's Stopwatch AND Study's focus-session
Stopwatch) were flying off-screen while spinning.** Both draw a
`<circle>` inside an `<svg viewBox="0 0 100 100">` and spin it
continuously via a CSS `rotate()` animation. Percentage-based
`transform-origin` on a bare SVG shape does not reliably resolve
against the shape's own geometry - depending on the renderer, it can
resolve against the SVG viewport/canvas instead, so "50% 50%" ends up
somewhere far from the circle's actual center, and the whole ring
visibly swings/drifts out of the card on every lap. `study.css`'s
`.study-ring-progress` had no `transform-origin` set at all (worst
case - default reference point, off in the corner); `timers.css`'s
`.timer-ring-progress` had `transform-origin: 50% 50%` but no
`transform-box`, which is what actually tells the browser to measure
that percentage against the shape's own bounding box. Fixed both by
adding `transform-box: fill-box;` alongside `transform-origin: 50%
50%;`. **This is the standards-correct fix (MDN explicitly documents
`fill-box` as the way to get intuitive percentage origins on SVG
shapes) - if any future ring/spinner is added anywhere in this project,
give its rotating element both properties from the start, don't rely
on the default.**

**Process note for future sessions (explicit user request):** once a
fix like this is confirmed, ship it as a version-bumped update - the
changed files plus a fresh zip - not a re-explanation of the whole
project or an unrelated rewrite. See "How to keep working on this" in
`PROJECT_BRIEFING.md`.

# DEX Labs v1.3.3 - Changes

Two feature requests for Study, plus a perf/dedup pass over the stats
code they both touch.

**1. Stats tab now has Today / Total sub-tabs.** "Total" is the
original Stats page, completely unchanged - year nav, summary tiles,
pie + Study/Rec split bars per subject, Days-this-year counts, Hours-
by-month chart. "Today" is the exact same page shape, just scoped to
today only: summary tiles, pie, and per-subject split bars for today's
sessions. (The year-nav, Days-this-year, and Hours-by-month pieces are
year-only concepts with no meaningful value for a single day, so they
don't appear in Today - everything that does carry over uses the same
markup/CSS as Total, just fed different data.)

**2. Clicking a date in the Calendar tab now shows that date's full
stats**, not just a "you studied N minutes" line. The day panel now
shows the same tiles + pie + per-subject Study/Rec breakdown as the new
Stats "Today" view, for whichever day you clicked - including days with
zero recorded time. The existing Slept / Did nothing / Clear mark
buttons are still there underneath, for days without a session.

**New backend endpoint:** `GET /api/study/stats/day/:date` (routes/
study.js -> lib/study-store.js's new `getDayStats()`), returning the
same subjectTotals/overallMs/studyOverallMs/recOverallMs shape as the
existing year-scoped `GET /api/study/stats`, just filtered to one
`YYYY-MM-DD` day instead of a whole year. Both now share a single
`buildSubjectStats()` helper for turning a (year- or day-scoped) list
of sessions into per-subject totals, so "today" can never silently
disagree with "this year" about how a given day's time adds up.

**Perf note, found while doing this refactor:** the old `getStats()`
computed every subject's `studySessionCount`/`recSessionCount` by
re-`.filter()`-ing the *entire* year's sessions/recSessions arrays once
per subject - O(subjects x sessions) for numbers it could have gotten
for free out of the single pass it already does to total up the
milliseconds. `buildSubjectStats()` now accumulates ms and counts
together in one pass over an already year/day-scoped array, for both
`getStats()` and the new `getDayStats()`.

**Frontend:** the "Time by subject" pie + Study/Rec split-bar block
(previously written out twice as the Stats page grew a Today view) is
now `buildSubjectBreakdownHtml()`, shared by Stats' Today, Stats'
Total, and the Calendar day panel - so all three read from one
implementation instead of three copies that could quietly drift apart
over future edits.

Verified end-to-end against a real running server: added a subject,
ran a real timed session through start -> finish, confirmed
`/api/study/stats/day/<today>` matches the per-day figures inside
`/api/study/stats?year=<year>` for the same date, confirmed an
out-of-range/malformed date is rejected with a clear error, and
confirmed a day with zero sessions returns a correctly-shaped
all-zero response rather than an error.

# DEX Labs v1.3.2 - Changes

Second round of performance work, on top of v1.3.1's backend fix, still
chasing the same low-end-hardware (Intel Celeron, 3GB RAM) sluggishness
report. This round is frontend: found a real polling leak, not just a
theoretical one.

**The problem:** Clock, Study, YouTube Downloader, and AirDrop each run
their own background poll (every 1-15 seconds) while their tab is open
- live countdowns, focus-session status, download progress, file-list
auto-refresh. Each one already cleared its OWN previous poll whenever
it was re-entered (switching sub-tabs, etc.) - but nothing stopped it
when the user navigated AWAY to a totally different subsystem instead.
Concretely: start a Study focus session, then spend the next two hours
using the Lesson Tracker - Study's 1-second poll kept running the
entire time, invisibly, hitting the server and doing DOM work every
second for zero benefit. The longer a browser tab stays open with
multiple subsystems having been visited, the more of these could stack
up running at once in the background. This is a very plausible
contributor to the app "getting spotty" the longer a session runs,
which is exactly how it was described.

**Fix:** every module that owns a poll loop (`timers.js`, `study.js`,
`ytdownload.js`, `airdrop.js`, `sbm.js`) now exposes a `cleanup()` (most
already had the clearInterval logic internally for their own re-render
case - this just exposes it). `app.js`'s router now tracks which
subsystem is currently active and calls the outgoing one's `cleanup()`
once, right before switching to a different one - including Lesson
Tracker's `#/subject/...` sub-pages, which took a separate code path
that would otherwise have been missed.

One scoping detail worth recording for a future session: the "currently
active subsystem" tracker has to live outside `route()`, not inside it
- `route()` re-runs on every single hashchange, so a variable declared
inside it would reset on every navigation and the cleanup would never
actually fire. Verified this in isolation (a standalone repro of the
exact closure pattern, run through a sequence of simulated
navigations) before trusting it in the real file - cleanup fired
exactly once per genuine subsystem switch, and correctly did NOT fire
when re-entering the same subsystem (e.g. switching between Study's own
Study/Stats/Calendar sub-tabs).

Also verified end-to-end against the real running server after this
change: server boots clean, all subsystem routes still load, static
assets and the Settings/Study/Timers/Events APIs still respond
correctly through v1.3.1's caching layer with this change layered on
top.

Not done in this pass (noted for a future round rather than silently
skipped): a Page Visibility API pause (stopping 1-second polls
entirely while the browser tab itself is minimized/backgrounded, on
top of the cross-subsystem fix above) would be a reasonable next step,
but browsers already throttle background-tab timers on their own, so
the marginal win looked smaller than this round's fix and wasn't
pursued yet to keep this release properly tested rather than rushed.

# DEX Labs v1.3.1 - Changes

Performance fix. The user reported the whole site feeling laggy/slow to
respond to clicks, plus the tray icon sometimes lagging or getting
stuck, on a low-end machine (Intel Celeron, 3GB RAM).

Root cause found: every subsystem's data store (Timers, Study,
Stopwatch, Events, Config, Schedule, AirDrop, YouTube Downloader) was
doing a **synchronous** disk read on every single call, with no
in-memory caching - `fs.readFileSync` + `JSON.parse` from scratch, every
time, for every request. Node.js is single-threaded, so a blocking sync
disk read/write stalls the ENTIRE server for that moment, not just the
one request that triggered it - every other tab, every other click,
waits behind it.

The worst offender by far: `lib/timers-store.js`'s tick loop, which
server.js runs every second FOREVER (needed for the Clock's
server-authoritative timers/alarms) - it was doing a full synchronous
disk READ *and* WRITE every single second, even with zero timers
running, all day, every day. On slower storage (the kind paired with a
budget Celeron box) that's a guaranteed stutter once a second,
competing with whatever the user just clicked - and since the tray app
talks to this same local server and waits on its responses (e.g.
opening menus, toggling settings), a server that's periodically
stalling is a very plausible cause of the tray "lagging or getting
stuck" too.

Fixes:
- `lib/timers-store.js`: data is now cached in memory (this process is
  the only writer, so that's safe); the 1-second tick does a cheap
  in-memory check first and skips ALL disk I/O when nothing actually
  changed (the common case almost all the time - most people aren't
  running a timer/alarm most of the time).
- Same in-memory-cache treatment applied to `lib/study-store.js`,
  `lib/stopwatch-store.js`, `lib/events-store.js`,
  `lib/config-store.js`, `lib/schedule-store.js`,
  `lib/airdrop-store.js`, and `lib/ytdownload-store.js` - all of these
  get hit by 1-15 second frontend polling loops (Clock, Study focus
  sessions, AirDrop auto-refresh, YouTube Downloader progress) and were
  each doing a needless full synchronous disk read on every single
  poll, from every connected device.
- Bonus bug found while testing this: `timers-store.js`'s `dismiss()`
  never actually set `dismissedAt` on the timer, so the "clean up
  dismissed timers after 1 hour" logic was reading `undefined` (falling
  back to `0`) and treating every dismissed timer as effectively
  infinitely old - meaning dismissed timers were getting wiped on the
  very next tick (within ~1 second) instead of sticking around for the
  intended hour. Fixed to actually stamp `dismissedAt = Date.now()`.

All of the above was verified against the real running server (create
a timer, let it expire and ring, dismiss it, confirm it now correctly
survives on disk instead of vanishing instantly; confirmed Stopwatch,
Study, Events, and Settings/theme endpoints all still work correctly
through the cache) - not just read through and assumed correct.

Not changed in this pass (documented here so a future session doesn't
re-investigate from scratch): `express.static`'s cache headers
(`maxAge: 0` with `etag`/`lastModified` on) were checked and are
already reasonable - the browser still does a cheap conditional
revalidation request rather than a blind full re-download, so this
wasn't a meaningful contributor. Standby Mode's "ultra graphics"
follow-mouse creature already defaults to off (`sbmUltraGraphics:
false` in `lib/config-store.js`) - worth keeping off on this hardware,
but wasn't a bug. tray.ps1's own hot paths (5s watchdog timer, click
handlers) were checked for known-slow patterns (WMI/CIM calls, etc.) -
the only CIM calls are in `Clear-DexNodeProcess`/
`Clear-DuplicateTrayInstances`, which only run at startup/restart, not
in the recurring watchdog loop - so no changes were needed there.

# DEX Labs v1.3.0 - Changes

Fixed the Lesson Tracker routing bug first, then built out five pieces
of new work: global dark/light mode, an Events tab (with a load-once
daily banner), a 12/24-hour clock setting, a whole new **Standby Mode**
subsystem, and a Windows auto-start repair mechanism. Windows
auto-start work is explicitly flagged untested-by-Claude below - it's
Scheduled Task/UAC/registry territory that can't be exercised in a
Linux sandbox.

## Bug fix: Lesson Tracker stopped responding after navigating away from it

- **Root cause, found by reproducing it (not guessed):** Lesson Tracker
  was registered with `hash: '#/'` in `lib/subsystems-registry.js` - the
  literal root hash. `public/js/app.js`'s `parseHash()` reduces `'#/'`
  down to an empty `parts` array, which is *exactly* what a bare URL
  with no hash at all also produces. `route()` had no explicit
  `if (parts[0] === 'lessons')` branch (unlike AirDrop/Schedule/Clock,
  which each get one), so any time `parts.length === 0` it always fell
  through to `dispatch(landingId())` - the currently-configured
  `defaultLandingSubsystem`, not "Lesson Tracker" specifically. As long
  as that setting was left at its default (`'lessons'`), the two things
  were indistinguishable and it looked fine. The moment it's set to
  anything else (a real, user-facing "what shows first" Settings
  option), clicking the Lesson Tracker tab silently re-ran
  `landingId()` and re-rendered whatever the configured landing
  subsystem currently was instead - including doing nothing visibly if
  you were already looking at that subsystem, which is exactly
  "clicking its tab does nothing."
- **Reproduced directly** with a jsdom harness driving the real
  `public/js/app.js` against the real running server: with
  `defaultLandingSubsystem: 'study'`, clicking Study then Lesson Tracker
  left the view on Study, hash `#/`, `subsystem-label` still "Study" -
  Lesson Tracker never rendered.
- **Fix:** gave Lesson Tracker a real, non-colliding hash (`'#/lessons'`,
  same as every other subsystem already has) and an explicit
  `if (parts[0] === 'lessons') return dispatch('lessons');` branch in
  `route()`, same pattern as AirDrop/Schedule/Clock - "handled the same
  generic way as every other subsystem," not a special case. `'#/'`
  itself is untouched and still means "go to the landing subsystem" -
  used by the brand-logo click and the post-setup redirect, which is
  correct as-is.
- **Same latent bug also lived inside Lesson Tracker's own "Subjects"
  breadcrumbs** (several `href: '#/'` / `location.hash = '#/'` spots
  inside its own subject-page views, meant to mean "go back to Lesson
  Tracker") - fixed to point at `'#/lessons'` explicitly instead, so
  they can't silently land somewhere else either.
- **Verified for real**, per the usual testing bar: real HTTP against
  the real server, real DOM clicks (jsdom driving the actual shipped
  `app.js`, not a mock). Covered: the exact repro steps requested (fresh
  load, Settings default, 2-3 subsystems in different orders, Lesson
  Tracker each time - all passed); the original failing case
  (`defaultLandingSubsystem: 'study'`) now passes; and the "Subjects"
  breadcrumb from inside a subject page correctly returns to Lesson
  Tracker regardless of what the landing subsystem is set to.

## Global dark/light mode

- **Reachable from every subsystem** via a 🌙/☀ toggle in the shared
  header (next to the LAN-address button), not per-subsystem.
- **The whole site respects it**, not just the shell - every
  subsystem's CSS was already built on shared design-token variables
  (`--paper`, `--card`, `--ink`, `--ink-soft`, `--pen`, `--highlight`,
  `--margin`, `--success`, plus two new ones added for this,
  `--gold-text` and `--error-soft-bg`) in `public/css/style.css`, so an
  `html[data-theme="dark"]` override block re-themes the entire site at
  once. Audited every hardcoded hex color across all seven CSS files and
  replaced the handful that were actually theme-fragile (a few `#fff`
  surface fills, two muted-gold text colors, one solid pastel background
  in `ytdownload.css` converted to a translucent `rgba()` like every
  other subsystem's "soft" tone already was) - left per-subsystem brand
  accent colors alone, since those are identity colors, not
  surface/text colors.
- **State lives server-side** (`GET`/`PUT /api/settings/theme`), same
  model as every other setting in this app (one shared config, not
  per-device - unlike the events banner below, which deliberately is
  per-device because the brief specifically asked for that there).
- **Auto-switching by fixed local clock hours** (default 7pm-7am dark,
  configurable in Settings) - not sunrise/sunset, confirmed with the
  user given there's no reliable geolocation to base that on.
- **Manual toggle holds for 24 hours**, then automatically resumes
  auto-switching - `themeOverrideUntil` is checked lazily (no
  background timer/cron) every time the theme is read, and gets written
  back to `'auto'` the moment it's found expired, so the stored state
  never drifts from what's actually being served. Verified directly:
  set an already-expired `themeOverrideUntil`, confirmed the very next
  `GET` reverted it to `auto` and persisted that.
- Tested live: toggle flips `dark`/`light` and applies instantly;
  `PUT { mode: 'dark' }` / `{ mode: 'light' }` / `{ mode: 'auto' }` all
  behave correctly; 24h expiry-and-revert confirmed against a real
  expired timestamp.

## Events tab (inside Clock) + load-once-per-day-per-device banner

- **New "📌 Events" tab** inside the existing Clock subsystem
  (`#/timers/events`) - name + target date, own store
  (`lib/events-store.js` / `data/events.json`), own router
  (`routes/events.js`, mounted at `/api/events`). Seeded with
  **G.C.E. O/L Exam, December 5th 2026** as requested, with an "Add
  event" form for more.
- Countdown shown in days/weeks/months as appropriate (a shared
  `formatRemaining()` helper in `timers.js`, exposed as
  `window.DexEvents` so the banner and Standby Mode below reuse the
  exact same formatting instead of three slightly-different copies).
- **Banner is genuinely per-device**, not per-server like the existing
  update-notice banner - the brief was explicit about this being
  different, so instead of reusing the update banner's server-side ack
  (which would dismiss it for every device at once), this tracks
  "already shown today" in `localStorage`. Reuses the *shape* of the
  update banner's mechanism (blocking modal, OK to dismiss) but not its
  per-server data flow, since the requirement itself is different.
- **Can only be dismissed with OK** - no ✕, no backdrop click, no
  Escape (a new `showBlockingModal()` helper, distinct from the general
  `showModal()` used elsewhere, which *does* allow those). Verified
  directly: backdrop click and Escape both leave it open; only the OK
  button closes it and sets the localStorage flag; a second page load
  the same day (simulated by pre-setting that flag) correctly shows no
  banner at all.
- All three (Events tab, banner, Standby Mode's events section) read
  from the same `GET /api/events/upcoming` - one source of truth, no
  risk of drift between them.

## 12/24-hour clock setting

- Added to Settings, but **scoped to Standby Mode's own big clock
  only** - confirmed with the user as explicitly NOT global for
  v1.3.0, unlike the initial assumption in the brief that it might be.

## New subsystem: Standby Mode (SBM)

Registered as an ordinary subsystem tab (`#/sbm`) - confirmed with the
user rather than building it as a separate full-screen mode with its
own entry point. Uses the generic `window.DexSubsystems` fallback
already in `app.js`'s `route()` (same as YouTube Downloader) - no
special-casing needed there at all.

- **Live Study/Rec clock, only when one is actually running.** Polls
  the *same* `/api/study/active` and `/api/study/rec/active` endpoints
  Study's own tab uses, and its pause/resume/finish buttons call the
  *same* `/api/study/active/...` routes - genuinely mirrors the real
  session rather than running a second independent timer. Verified
  directly: started a real Study session via the API, confirmed SBM
  picked it up and displayed it, clicked SBM's own Pause button, then
  confirmed via `GET /api/study/active` that the *actual* session
  (same `id`) now shows `running: false` - not a separate SBM-only
  state. Section is entirely absent (no placeholder) when nothing's
  running.
- **Big clock**, `HH:MM:SS`, sized with `clamp()` to look intentional
  on a tall 1280x1024 monitor and scale down cleanly for mobile without
  a pile of separate media queries. Seconds digit animates on change
  (a re-triggerable CSS keyframe, not a hard cut) - uses the viewing
  device's own local time rather than round-tripping to the server
  every second.
- **Events section**, reusing the Events tab's data/formatting (see
  above) - absent when there are no upcoming events.
- **Host RAM/CPU stats**, on by default with a Settings toggle. RAM via
  `os.totalmem()`/`os.freemem()`; CPU via sampling `os.cpus()` twice and
  diffing tick counters (works cross-platform including Windows, unlike
  `os.loadavg()` which Windows doesn't meaningfully support). **No
  temperature in v1.3.0** - confirmed with the user given it's not
  reliably available cross-platform without extra tooling.
- **New science fact every hour** - `lib/facts-store.js`, seeded with
  188 facts (`lib/facts-seed.json`). Cheap-and-simple approach per the
  brief: each fact marked `used` (never deleted) once shown; picking
  the next hour's fact skips anything already used, so nothing repeats
  until the whole pool cycles (well over a week at this pool size -
  comfortably covers "never repeat a fact used the previous day").
  Top-up check triggers ~70 days after facts were last added (tracked
  via `lastAddedAt`), rather than tracking an exact remaining count.
  "Current hour's fact" is computed and cached server-side (one shared
  fact per hour, not a different one per device/reload).
- **Visual polish**: base dark/light comes free from the shared design
  tokens (see above). A separate, independent "ultra animations / 3D
  effects" Settings toggle layers on a subtle animated gradient wash and
  glow border on top of that - off by default, not tied to dark/light
  mode.
- **Follow-mouse creature** - 30 legs (confirmed leg count via a live
  DOM query in testing), SVG-based, smooth lerp-following with edge
  steering so it stays inside its container instead of clipping through
  the sides. **v1.3.0 scope confirmed as Standby Mode only** (built as
  a self-contained `makeCreature(container, size)` factory needing only
  a container element, so a future release can reuse it elsewhere
  without rework - not wired up anywhere else yet). Requires dark mode
  **and** ultra graphics **and** its own enable toggle **and** a
  desktop/fine pointer (checked via `matchMedia('(pointer: fine)')`) -
  all four, verified independently by toggling each one off and
  confirming the creature correctly disappears. Size is a 1-10 Settings
  slider. Idle behavior: retreats toward the nearest corner and fades
  after ~2.5s of no mouse movement, comes back out the instant the mouse
  moves again - verified directly with simulated `mousemove` events and
  timing.

## Windows auto-start repair (untested by Claude - see below)

- **Root cause diagnosed by reading `install.bat`, `tray.ps1`,
  `create-shortcuts.ps1`, and `apply-update.ps1`:** the Startup-folder
  auto-start entry was only ever *created* by `install.bat`, and
  nothing ever re-checked or repaired it afterwards - including
  `apply-update.ps1`, which is what actually runs on every update via
  the tray's "Check for Updates" menu or `update.bat`. If that entry
  ever went missing (a common cause: antivirus/Defender flagging a
  hidden-launch script sitting in the Startup folder, since that's also
  a known malware pattern), updating did nothing to bring it back - only
  manually re-running `install.bat` from scratch would, which isn't
  the normal update path anyone actually uses.
- **`DEXLABS.bat`** (new, root of the project): idempotent, no
  elevation needed (the Startup folder and shortcut files there are
  always user-writable). (Re)creates a `DEX Labs.lnk` Startup shortcut
  pointing at the existing `run-hidden.vbs` launcher (already used by
  `start.bat` and the Desktop/Start Menu shortcuts), replacing the
  separate inline copy of the same logic `install.bat` used to write
  directly - one launcher, one place it's defined. Cleans up the old
  pre-v1.3.0 `LessonTracker.vbs` entry if found. Safe to double-click by
  hand anytime auto-start seems broken, without reinstalling anything.
- **`apply-update.ps1` now calls `DEXLABS.bat /silent` automatically**
  at the end of every update (step 5.5) - this is what actually makes
  it self-healing going forward, since this is the script that runs on
  every real-world update path.
- **`install.bat` now calls `DEXLABS.bat /silent`** instead of writing
  its own separate inline VBS, consolidating onto one mechanism.
- **New: proper admin-elevated auto-start-at-boot**, registered via a
  Scheduled Task (`register-admin-autostart.ps1`) rather than a registry
  Run key - explicitly user-initiated only, via a new tray menu item
  ("Set Up Proper Auto-Start (Admin)...") that elevates *just* that one
  script (`Start-Process -Verb RunAs`), same idiom already used
  elsewhere in this project for the Landing Page's firewall rule - the
  tray itself never tries to silently self-elevate. Removes the
  permission-less `DEXLABS.bat` fallback once the Scheduled Task is
  registered, so the two don't both fire on the next login.
  - **Design assumption flagged for the user to confirm**: this asks
    for Administrator ONCE, at registration time - the Scheduled Task
    then runs elevated automatically on every login afterwards with
    no further UAC prompt. If a VISIBLE prompt at *every* login was
    actually wanted instead (more friction, but visible each time),
    that needs a different, simpler mechanism - flagged clearly in
    `register-admin-autostart.ps1`'s own header comment.
  - **Caught and fixed a real bug before it shipped**: the first draft
    of the tray menu handler used `Start-Process -ArgumentList` with a
    manually-quoted path - exactly the bug class `PROJECT_BRIEFING.md`
    documents from v0.2.2 (`Start-Process -ArgumentList` mangles
    embedded quotes when the underlying path has a space in it, and
    "DEX Labs" has one). Fixed using the same `-EncodedCommand`
    approach that fixed it the first time, before this ever reached the
    user.
- **Everything in this section is explicitly untested by Claude** - no
  Windows environment, Scheduled Task API, or UAC prompt available in
  this sandbox. `register-admin-autostart.ps1`'s header comment lists
  exactly what to check by hand (task registration, a real login,
  Task Manager/tray icon confirmation, the old Startup shortcut being
  removed).

## General

- No changes to `data/` schemas beyond additive new fields/files (new
  `themeMode`/`themeOverrideUntil`/`themeDarkStartHour`/
  `themeDarkEndHour`/`sbmStatsEnabled`/`sbmClockFormat`/
  `sbmUltraGraphics`/`sbmCreatureEnabled`/`sbmCreatureSize` in
  `config.json`, all with safe defaults; new `data/events.json` and
  `data/facts.json`) - existing installs need no migration step.
- Tested throughout via a jsdom harness driving the real, unmodified
  `public/js/*.js` against the real Node server over real HTTP -
  consistent with the project's existing "spin up the server as a
  subprocess, hit real endpoints" testing bar, not syntax-checks alone.

# DEX Labs v1.2.1 - Changes

Two related pieces of work: a new **Rec** tab (timing time spent
watching recorded lectures/videos) sitting alongside Study, and a
**Stats** upgrade so it shows Study and Rec time combined - both the
total per subject, and the two numbers broken out separately.

## New: Rec - a separate timer for watching recordings

- **New tab, right after Study** (`Study | Rec | Stats | Calendar`) - a
  plain manual timer: pick one of Study's existing subjects, start,
  stop, it logs the duration. Deliberately **not** a YouTube link paste
  or an embedded/detected video - DEX Labs doesn't know or care what's
  being watched, only that time is being spent against a subject. Same
  mechanic as Study's own Stopwatch mode, and it reuses Study's existing
  no-tick-loop timestamp-math design (`rawElapsedMs`) rather than
  reinventing it.
- **Uses Study's exact subjects list - no separate subject list, no
  "add subject" UI, no color picker of its own.** The Rec tab's subject
  picker is read-only: click a subject card to start timing against it
  immediately (no method choice needed, since there's no Pomodoro
  equivalent for watching a recording - no "rest phase" concept
  applies). Subjects (including their chart color) are still managed
  entirely from the Study tab.
- **Genuinely separate tracked time from Study, not the same thing with
  a label on it** - this was the one rule that mattered most for this
  release. Concretely, in `data/study.json`:
  - `recSessions` (saved Rec sessions) and `activeRecSession` (at most
    one in-progress Rec timer) are **new, separate top-level fields**,
    never merged into the existing `sessions`/`activeSession` and never
    sharing one array with a "type" discriminator - so there's no way a
    future query/loop over Study's own data can accidentally pick up
    Rec data, or vice versa.
  - **Starting/stopping a Rec timer is fully independent of any active
    Study session, and vice versa** - neither blocks the other. Tested
    directly: started a Study session and a Rec session on the *same*
    subject at the same time, confirmed both ran and reported correct
    independent elapsed times via `GET /api/study/active` and
    `GET /api/study/rec/active`, and confirmed finishing one has zero
    effect on the other.
  - Existing Study data, subjects, colors, sessions - completely
    unaffected. `lib/study-store.js`'s `read()` defaults `recSessions`
    to `[]` and `activeRecSession` to `null` for any pre-v1.2.1
    `data/study.json`, so no migration step is needed.
  - Deleting a subject now also refuses while it's the subject of an
    active Rec timer (mirroring the existing "can't delete mid-Study-
    session" guard) - tested directly: deletion was refused while a
    Study session was active on a subject, refused again (different
    error message) once that finished but a Rec timer was still active
    on it, and only succeeded once both were clear.
  - Same "too short to bother logging" discard rule as Study's Stopwatch
    (under 5 real seconds elapsed → discarded, not saved) - tested
    directly (a ~7ms Rec timer came back `discarded: true`).
- **New endpoints, all in the existing `routes/study.js` router (mounted
  at `/api/study`)** - Rec is "part of Study" (same subjects), not an
  unrelated concern, so it got new routes in Study's existing router file
  rather than a whole new subsystem/store (unlike Backup in v1.2.0, which
  genuinely was unrelated to everything else):
  `GET /rec/active`, `POST /rec/active/start`, `POST /rec/active/pause`,
  `POST /rec/active/resume`, `POST /rec/active/cancel`,
  `POST /rec/active/finish` - same shape as Study's existing
  `/active/...` routes.
- **An active Rec timer now also counts as "busy"** in `GET /api/busy`,
  same as an active Study session (v1.2.0) - so an update can't
  interrupt someone mid-recording either. `tray.ps1`'s
  `Test-DexSystemIdle` needed zero changes for this: it already just
  forwards whatever `busy`/`reasons` says, so adding the new `recording`
  flag/reason on the server side was the only change needed to make
  every update path (background timer, both interactive "Update" menu
  items) respect it. Confirmed via real HTTP requests: `busy: true` with
  both `"a study session is in progress"` and `"a Rec timer is in
  progress"` in `reasons` while both were running simultaneously, back to
  `busy: false` once both were finished.

## Stats: now combines Study + Rec

- **The pie/total-by-subject view is now Study + Rec time added
  together per subject** - `lib/study-store.js`'s `getStats()` computes
  `recSessions` totals in a second pass (same year-filter logic as the
  existing Study pass) and returns a `totalMs` per subject that's the
  sum of both. The existing pie chart and its legend needed no
  structural changes - they already just read `subjectTotals[].totalMs`.
- **New: a "Study vs Rec, per subject" two-segment bar**, replacing the
  old single-color per-subject bar. Each subject's row now shows two
  color segments (indigo for Study, amber for Rec) sized off the same
  cross-subject max, so the combined bar length still reads as "how much
  total time" while the color split shows where it came from, plus a
  text label like "4h 5m studied · 1h 20m watched" - so the split is
  visible at a glance, not hidden behind a merged total. `getStats()`'s
  `subjectTotals` rows now carry `studyMs`/`recMs` separately alongside
  `totalMs`.
- **New summary tiles**: "Total (Study + Rec)", "📖 Study", and "🎥 Rec"
  (replacing the old single "Total studied" + raw "Sessions" count
  tiles) - `getStats()` now also returns `studyOverallMs`/`recOverallMs`
  and `studySessionCount`/`recSessionCount` alongside the existing
  combined `overallMs`/`sessionCount`.
- **The "Hours by month" bar chart (v1.2.0) now includes Rec time too** -
  its `monthly` array sums both kinds of session into the same
  per-month buckets, no visual/structural change to the chart itself.
- **The Calendar tab (heatmap) and the "Days this year"
  Studied/Slept/Did-nothing counts stay Study-only, deliberately, for
  this version** - explicitly out of scope per the request. `getStats()`
  only ever writes Study session time into the per-day map the
  heatmap/day-counts are built from; the new Rec aggregation pass never
  touches it. Verified directly: a day with both a Study session and a
  Rec session logged showed the heatmap cell/day-count reflecting only
  the Study portion of that day's time, not the combined total.
- **Rec's own tab gets its own accent color "for free"**: the Rec tab
  wraps its content in a `.study-rec-scope` div that locally overrides
  the same `--study-accent`/`--study-accent-dark`/`--study-accent-soft`
  CSS variables every shared component (subject cards, the focus-view
  ring, etc.) already reads from - so Rec's tab automatically renders in
  its own warm amber/rust color everywhere, with zero duplicated CSS
  rules for a second set of card/ring/button styles.

Tested via the real server as a subprocess + real HTTP requests (not
just a syntax check): adding subjects, running a Study session and a
Rec session concurrently on the same subject and confirming both
independently report correct elapsed time, pausing/resuming/finishing/
canceling a Rec session, the sub-5-second discard rule, the subject-
delete guard against both an active Study session and an active Rec
session (checked separately, in sequence), `GET /api/busy` reflecting
both `studying` and `recording` flags together and individually, and
`GET /api/study/stats` returning correctly combined `subjectTotals`
(`studyMs`/`recMs`/`totalMs`), correctly combined `monthly` figures, and
a heatmap/`dayCounts` that only reflected Study time even when Rec time
existed on the same day. `data/study.json` was restored to its
pre-testing state (not shipped) after testing, same as every other
release.



Two unrelated pieces of work landed together in this release: a round of
Study fixes/polish, and a new backup system (the bulk of this release).
A third, small, unrelated fix rode along too - see "Also fixed" at the
bottom - found only because this release's own testing made "does a
truly empty data/ folder work" worth actually checking for the first
time.

# DEX Labs v1.2.0 - Changes

## Study: fixes and polish

- **Removed the "How was today so far? 😴 Slept / 🚫 Did nothing"
  quick-log banner** from the Stats tab. Existing recorded data (past
  sessions, and any days already marked Slept/Did nothing) is untouched -
  this only removes the daily nag prompt and the now-dead `quickLog()`
  frontend function behind its two buttons. The Calendar tab's own
  click-a-day-to-mark-it flow is a separate code path and still works
  exactly as before, including for today - this was a deliberate,
  narrower removal (the *proactive prompt*, not the underlying
  capability), on the reasoning that removing the ability to mark a day
  at all wasn't asked for and would be a worse mistake to make than
  under-removing.
- **Subjects can now have a manually-picked, permanently-saved chart
  color.** A small color swatch on each subject card (Study tab) opens
  the browser's native color picker; the choice is saved via `PUT
  /api/study/subjects/:id/color` into `data/study.json` (a new optional
  `color` field on each subject) and used everywhere a subject's color
  is shown - the Stats pie chart, its legend, and the per-subject bars.
  No custom color set → falls back to the original deterministic
  hash-of-subject-id color, so every subject that existed before this
  update looks exactly the same as it did.
- **Fixed the Calendar tab's month labels drifting out of alignment
  with the columns below them** (the actual bug behind "sometimes red
  light red yellow" - reported as the columns/labels not lining up).
  Root cause: `.study-heatmap-months` (the label row) was laid out with
  a 14px column width and no gap, while `.study-heatmap-grid` (the
  actual day-cell columns just below it) uses 13px columns with a 3px
  gap - a 14px pitch vs. a 16px pitch. Every column added 2px more
  drift than the last; by the end of a year (~52-53 columns) a month
  label could land nowhere near the column it was supposed to sit
  above. Fixed by giving both grids the exact same
  `grid-auto-columns`/`gap`, and correcting the label row's
  `margin-left` to match the day grid's actual start position (20px
  day-labels column + 3px flex gap = 23px, not the old 24px
  approximation). The underlying "which column gets which month's
  label" JS logic in `public/js/study.js` was already correct (matches
  GitHub's own approach of labeling the column containing a month's
  1st) - this was purely a CSS layout bug, not a date-math bug.
- **Bonus fix found while in that code:** the Calendar tab's "is this
  cell in the future" check used
  `new Date().toISOString().slice(0, 10)` - the UTC date, not the local
  one. For anyone east of UTC (this app's user is in Sri Lanka,
  UTC+5:30), that reads as "yesterday" for the first several hours
  after local midnight, which could make *today's* cell wrongly render
  as an unclickable future day right when it matters most (first thing
  in the morning). Replaced with a `localTodayStr()` helper that
  mirrors `lib/study-store.js`'s own `localDateStr()` (local
  year/month/day, not UTC) - the two now agree.
- **Added an "Hours by month" bar chart** to the Stats tab, below the
  existing pie/legend/per-subject-bars block - a full-year-at-a-glance
  view that neither the pie (breaks down by subject, not by when) nor
  the Calendar heatmap (precise but day-by-day, hard to see monthly
  trends in) currently gives. Plain CSS-height divs, same
  no-charting-library approach the existing per-subject bars already
  use. `lib/study-store.js`'s `getStats()` now also returns a `monthly`
  array (`[{month:1..12, ms}]`, this-year-only, computed in the same
  single pass as the existing day/subject totals).
- Backend: `lib/study-store.js` gained `setSubjectColor()` (validates a
  6-digit hex code, or empty to reset to automatic) and `getStats()`'s
  `subjectTotals` rows now include each subject's `color`. New route:
  `PUT /api/study/subjects/:id/color`.

Tested via the real server as a subprocess + real HTTP requests: adding
subjects, setting/clearing/rejecting colors, a full session producing
correct `monthly`/`color`-tagged stats output.

## New: Backup (disk + Google Drive)

A new cross-cutting feature (not a subsystem - no nav tab; it's
configured from the Settings page, same as AirDrop's settings), so that
losing the DEX Labs folder (reinstall, accidental delete, disk failure)
doesn't mean losing everything in it.

**Two independent targets, both new files `lib/backup-store.js` +
`routes/backup.js` (mounted at `/api/backup`):**

- **Disk backup - mandatory.** The person picks a folder anywhere on
  their PC *other than* the DEX Labs folder itself (enforced -
  `setDiskPath()` rejects a path inside `AppRoot`, since backing up
  inside the very folder a reinstall would delete defeats the point).
  Every `data/*.json` file is copied into
  `<their folder>/DexLabsBackup/`, one file at a time with a tmp+rename
  per file (same safety pattern every store's own `write()` already
  uses), every 3 minutes (`setInterval` in `server.js`), plus once
  immediately whenever the path is (re)saved so Settings shows a real
  result right away instead of a 3-minute wait.
- **Google Drive backup - optional.** Standard OAuth2 "Desktop app"
  loopback flow. The person creates their own free Google Cloud OAuth
  client (Client ID + Secret, entered in Settings) - this app can't
  provision one on their behalf, since every self-hosted DEX Labs
  install runs on its own `http://localhost:<port>`, which is exactly
  what Google's "Desktop app" OAuth client type is for (accepts *any*
  localhost port as a redirect URI, nothing to pre-register, unlike the
  "Web application" client type). Uses **only the `drive.file`
  scope** - this app can see/manage only files it created itself, never
  the rest of the person's Drive. `GET /api/backup/drive/auth-url`
  builds the consent URL (`access_type=offline&prompt=consent`, so a
  refresh token is always issued); `GET
  /api/backup/drive/oauth-callback` is where Google redirects back to
  (a real page navigation, not a fetch - responds with a small HTML
  confirmation page, not JSON), exchanges the code for tokens, and
  auto-creates (or finds) a "DEX Labs Backups" folder in their Drive.
  Backs up every 30 minutes, uploading each `data/*.json` file
  individually (find-by-name-in-folder, then update-in-place if found,
  multipart-create if not - no zip dependency). Access tokens
  auto-refresh on expiry; a revoked/expired refresh token auto-unlinks
  (`driveLinked: false`) with a clear stored error rather than failing
  silently every 30 minutes forever.
- **`data/backup.json` itself (which holds the Drive Client Secret and
  refresh token) is deliberately excluded from both backup targets** -
  a real bug caught during testing, not a hypothetical: without the
  exclusion, the first Drive backup after linking would upload the
  Drive OAuth token *into the very Drive folder that token
  authenticates to*, and the disk backup would carry it into whatever
  folder the person picked (which might itself be synced somewhere by
  Dropbox/OneDrive/etc., carrying the token along for no reason). Both
  `runDiskBackup()`/`runDriveBackup()` now go through a shared
  `backableDataFiles()` helper that filters `backup.json` out; the
  restore path skips it too, as a second layer, independent of the
  upload-side fix.
- **Restore-on-fresh-install-or-reinstall.** `maybeRestoreFromDrive()`
  only ever runs once per process start, gated on whether `data/` had
  zero `*.json` files in it at the *exact moment the process started*
  - captured at the very top of `server.js`, before any
  `lib/*-store.js` is `require()`'d. This ordering matters: every store
  in this project auto-creates its own default `data/*.json` the
  instant it's required if the file doesn't exist yet, so if this check
  ran even one line later (after the first store require), "is data/
  empty" would already be permanently false and a fresh install could
  never restore from Drive at all. As a second, independent safety
  layer on top of that gate, the actual per-file restore additionally
  re-checks "does this exact file already exist locally" and skips it
  if so - so even if the gate were somehow wrong, restore can never
  overwrite a file that's already there. Runs fire-and-forget after
  `app.listen()` succeeds (doesn't delay the port coming up for what's
  a nice-to-have speed-up, not a blocking requirement).
- **Settings page (`public/js/settings.js`)** gained a new "Backup"
  panel: disk path text field + a "Browse…" button (spawns a native
  Windows folder-picker dialog via a short PowerShell
  `FolderBrowserDialog` script, same technique tray.ps1 already uses
  for its own file dialogs - gracefully falls back to "type it
  yourself" if that fails, e.g. not on Windows) + Save + a manual "Back
  up now"; a Google credentials form (with numbered setup instructions
  and a link to Google Cloud Console) that becomes a "Connect Google
  Drive" button once saved, which becomes a linked status
  (last-backup-time + "Back up now" + "Disconnect") once connected.
  Connecting opens Google's consent screen in a new tab (can't happen
  in an iframe/same-tab, it's a real OAuth redirect); the original
  Settings tab polls `/api/backup/status` every 2s for up to 2 minutes
  afterward so it updates itself the moment linking completes, without
  needing a manual refresh.
- **The disk backup folder is now mandatory, using the exact same
  forced-first-run-setup mechanism v1.0.5 built for AirDrop's
  settings** (`Settings.isSetupComplete()`, checked by every route in
  `app.js` before allowing navigation anywhere else) - extended rather
  than duplicated: it now also fetches `/api/backup/status` and
  requires `disk.configured`. This applies to existing installs
  updating to v1.2.0 too, not just fresh ones - an existing user's
  `config.json` already has `setupComplete: true` from before, but
  `backup.json` won't have a disk path yet, so they'll be sent back to
  Settings once (banner text adapts to say only what's actually still
  needed - AirDrop config, backup folder, or both).

**System update process (`tray.ps1`, `apply-update.ps1`):**

- **Singleton enforcement via a named Mutex**, acquired at the very top
  of `tray.ps1`, before anything else runs. This is a real gap being
  fixed, not a hypothetical: the Desktop/Start Menu shortcuts (built by
  `create-shortcuts.ps1`) launch `run-hidden.vbs` → `tray.ps1` directly,
  bypassing `clear-port.bat`'s existing dupe-killing entirely (that
  only runs via install.bat/start.bat/debug.bat/update.bat). If
  tray.ps1 was already running (e.g. from Windows Startup) and the
  person double-clicked the Desktop icon, a second full tray.ps1 +
  server process would previously spawn alongside it. A named Mutex is
  an OS-level atomic check, so unlike `Clear-DuplicateTrayInstances`
  (still present, still runs as a defensive backstop for other edge
  cases) - which kills rivals *after* already starting, which can race
  if two launches happen close together - acquiring the Mutex can never
  race: exactly one instance wins, and a redundant launch exits
  immediately without ever touching the already-running instance's
  server, tray icon, or anything it has in flight (an active study
  session, a running timer, an AirDrop transfer). No popup/console on
  the redundant exit, consistent with this script never showing its
  own window (see the file's own "Architecture note" at the top).
- **"No update while studying" is now an absolute rule** across all
  three update paths (the silent background checker, and both
  interactive "Check for Updates" menu items), not just something the
  background checker happened to already respect. Server-side,
  `GET /api/busy` now also reports `studying: true` (via
  `studyStore.getActive()`) whenever a Study session is running/paused,
  alongside the existing upload/timer/download checks -
  `Test-DexSystemIdle` in tray.ps1 needed zero changes since it already
  just forwards whatever `/api/busy` says. What *did* need changing:
  the two interactive menu items (`$menuUpdateAuto`, `$menuUpdateManual`)
  never called `Test-DexSystemIdle` at all before this - clicking
  either mid-study-session would have gone ahead regardless. Both now
  check twice: once before downloading/confirming (fail fast, don't
  make someone wait through a download just to be told no), and again
  immediately before the server actually stops (covers studying
  starting during that window).
- **A fresh disk+Drive backup is triggered right before every update**,
  while the server is still up and can still reach Drive - added to the
  shared `Install-DexUpdateFromDownloadedZip` function (covers the
  background path and the interactive "Check for Updates (Auto)" path)
  **and** separately to `$menuUpdateManual`'s handler, which has never
  gone through that shared function (it can't - that function deletes
  the zip it's given afterward, which would be wrong here since a manually
  *selected* file might be something the person wants to keep, unlike a
  throwaway downloaded-to-temp zip - so this path has always had its
  own inline copy of the stop/apply/start steps, which needed the same
  addition repeated rather than shared). Best-effort with a 25s
  timeout - a slow/unreachable Drive never blocks the update, and
  `apply-update.ps1`'s own long-standing `backups/backup-<timestamp>/`
  snapshot (unchanged) still runs right after regardless, so this is a
  third, additional safety layer on top of two that already existed,
  not a replacement for either.

**Tested:** the entire Google Drive OAuth/backup/restore code path
against a synthetic mock of Google's OAuth token + Drive v3 REST APIs
(same offline-mock methodology this project already uses for YouTube
parsing, since this sandbox has no network access to
accounts.google.com/googleapis.com and no real OAuth credentials to
test against) - link, folder auto-create, upload, update-in-place
(not duplicate), token auto-refresh-on-expiry, restore-only-when-
data-dir-was-empty (and never overwriting an existing file), a
rejected auth code, and a revoked refresh token auto-unlinking with a
clear error - 10 scenarios, all passing. Disk backup tested for real
(actual file copies to a real external directory, including the
inside-the-app-folder rejection and the `backup.json` exclusion). The
Settings page's new HTML-building functions (`backupHtml`/`formHtml`)
were extracted and exercised directly against real API response shapes
for every state (fresh/credentials-saved/linked/error) to verify
correct conditional rendering and event-listener wiring without a
literal browser. **Not tested** (same standing limitation as every
PowerShell/Windows-only piece in this project across every prior
release): the actual Mutex/singleton behavior, the folder-browse
dialog, and the two updated interactive menu handlers, on real Windows
- no Windows/PowerShell available in this environment. Also not tested:
a real, live Google OAuth consent screen round-trip (no network access
to Google's domains from this sandbox either) - the mocked tests above
verify the request/response *handling* is correct, but the actual
"does Google's real consent screen redirect back correctly" step is
unverified against the live service.

## Also fixed: Lesson Tracker 500'd on a genuinely fresh install

Unrelated to everything above, found while testing this release (which
made "does a truly empty `data/` folder work correctly" worth checking
end to end for the first time, because of the new restore-from-Drive
path). `db.js` (Lesson Tracker's tiny JSON-file DB) was the one store in
this whole project that never auto-created its own default data file -
every other one (`lib/config-store.js`, `lib/study-store.js`, etc.)
guards with `if (!fs.existsSync(...)) fs.writeFileSync(...)`; `db.js`
just did `fs.readFileSync(DB_PATH)` with no fallback. On a genuinely
empty `data/` folder (a true fresh install, or a reinstall after
removal), that meant `GET /api/subjects` - Lesson Tracker's very first
request - 500'd immediately, and stayed broken until a subject was
somehow created some other way. Not something either of this release's
two features caused; nothing about `db.js`'s actual read/write/update
logic changed, and any existing `data/db.json` is completely unaffected
(the new guard only fires when the file doesn't exist yet). Given how
directly this bears on the exact "fresh install must work" property the
new backup/restore feature exists to protect, it felt wrong to notice
and not fix it in the same release rather than filing it away for later.

# DEX Labs v1.1.9 - Changes

## Landing Page: automatic network discovery ("Found on your network")

The Landing Page (the "🏠 Websites on this computer" page at port 80)
now automatically finds other websites reachable from this machine on
the same local network - router/CCTV/NVR admin pages, other computers,
game consoles, or another DEX Labs install - and lists them with an
icon and page title, without you having to already know their IP or add
them by hand.

- Fully automatic: no button, no manual trigger. On page load it scans
  once, then loops forever on its own - a short "Next scan in 3s / 2s /
  1s" countdown, then "Scanning…", then back to the countdown, for as
  long as the page stays open.
- Auto-detects this machine's own subnet (e.g. `192.168.1.x`) and
  checks every address on it (`.1`-`.254`) against a fixed list of
  common website ports (80, 443, 8080/8081/8443, 8000, 8888, 3000,
  5000, 9000, 9090, common router ports 81/82/88, Plex's 32400).
- Only shows things that actually behaved like a website - i.e. gave
  back a real HTTP response - not just "something is listening on this
  port." A camera's raw RTSP stream or a printer's raw port, for
  example, are deliberately not included; this list is specifically
  "websites," matching the rest of this page.
- Each result shows the site's own favicon (fetched directly from
  `<that device>/favicon.ico`, falling back to a generic icon if it
  doesn't have one) and its page `<title>` (falling back to `ip:port`
  if the page has none), and is a direct clickable link.
- Lives entirely inside `landing-page/` - `landing-page/lib/discover.js`
  (the scan itself, ported from an earlier draft of this that briefly
  shipped as a separate DEX Labs subsystem page - that was the wrong
  place for it) plus a new `GET /api/discover` endpoint in
  `landing-page/server.js`, and the countdown/render loop in
  `landing-page/public/app.js`. The existing manually-added site list
  (`Your saved websites`, same Add/Edit/Remove as before) is unchanged
  and still lives below it on the same page.

**Scope, by design:** this only ever scans the local subnet this
machine is already connected to - never the wider internet - and it
only does a plain TCP connect plus a normal GET request to read the
page title/favicon. It doesn't attempt any logins, doesn't guess
passwords, and doesn't exploit anything it finds - it's purely a
"what's reachable and what does it look like" inventory, the same kind
of thing a router's own device list or an app like Fing does. Because
it will surface *any* device that answers - including a neighbour's, on
a shared building/apartment WiFi - the "Found on your network" section
includes a short on-screen reminder to only use it on networks you own
or have permission to look around on.

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
