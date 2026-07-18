# DEX Labs — Project Briefing (for a new Claude session)

This document exists so a fresh Claude conversation can pick up this
project with full context, without needing the entire chat history that
built it. Paste this whole file as the first message in a new
conversation, along with the current project zip.

## What this project is

A personal, self-hosted website that runs on the user's own Windows PC
and is reachable by any phone/PC on the same home WiFi (no internet
exposure, no cloud, no accounts). Built with plain Node.js + Express on
the backend and plain HTML/CSS/JS on the frontend (no build step, no
framework, no bundler - everything is directly editable and directly
served).

The site is called **DEX Labs**. It is explicitly meant to grow into the
user's general personal website over time. As of v1.1.5 it has six
independent **subsystems** (see "v1.1.5" near the end of this file for
the newest one and how it was integrated):

1. **Lesson Tracker** — the original feature. Lets the user (a student)
   organize YouTube lesson videos and playlists by subject and category
   (categories used to be hardcoded "Grade 10"/"Grade 11", now
   renameable/addable/deletable), track which videos they've already
   watched (click a thumbnail to blur it out), view a lesson's full
   title + description on demand, and upload/download "tute" files (any
   file type, up to 5GB each) per subject.
2. **AirDrop** — a LAN file-share tool. Drop a file in from any device on
   the WiFi, grab it from any other device, files self-delete after 1
   hour. Capped at a 30GB *combined session total* (not per-file).
3. **Daily Schedule** — a static 3-day × 3-subject planner grid. Fill in
   what to study each day, save it, stays exactly as saved until
   deliberately edited again. Deliberately does NOT reference Lesson
   Tracker's subject list - just free-text strings the user types in
   (explicit user requirement: "don't integrate this to the other
   subsystems, this is its own system").
4. **Clock** (id `timers` in the registry - never renamed, only the
   label - was called "Timers" through v1.1.0) — 3 menus in one
   subsystem: **Timer**, **Alarm**, **Stopwatch** (Stopwatch added in
   v1.1.1). Timer/Alarm: up to 10 at once, shown as circular countdowns,
   **server-authoritative** (state lives in `data/timers.json`, tracked
   by a 1-second server-side tick loop in `lib/timers-store.js`), not
   just a browser `setTimeout` - this is deliberate: when one expires,
   the SERVER MACHINE itself beeps loudly through its own speakers (as
   of v1.1.1, a synthesized WAV played via `System.Media.SoundPlayer` so
   it reaches Bluetooth output too - see CHANGES.md's v1.1.1 section for
   why the earlier `[console]::beep` approach was replaced), re-beeping
   every 4s until dismissed, regardless of whether any browser has the
   page open. Stopwatch: up to 10 independently named stopwatches,
   start/pause/resume/lap/reset, own store (`lib/stopwatch-store.js`,
   `data/stopwatch.json`) - server-backed for correctness across
   reloads/restarts but needs no tick loop or beep (pure elapsed-time
   math off stored timestamps, no alerting). This is the other piece
   (besides the tray app) that could not be tested end-to-end in this
   environment - no Windows/speakers available. The tick loop, expiry
   transition, dismiss/cancel flow, and (v1.1.1) the full stopwatch
   CRUD/pause-math ARE thoroughly tested (via real HTTP requests /
   direct store calls against the running server); only the actual
   audible beep on real hardware (including the new Bluetooth fix) is
   unverified.
5. **YouTube Downloader** (v1.1.0) - drives `yt-dlp` as a child process
   to download videos/playlists to `downloads-youtube/`.
6. **Study** (v1.1.5) - subjects the user is studying, a focus-session
   timer (Stopwatch or Pomodoro, server-authoritative like Clock's
   Stopwatch), per-subject hours stats (pie + bar charts), a
   Studied/Slept/Did-nothing day count, and a GitHub-style year
   heatmap. See "v1.1.5" near the end of this file for full detail.

All subsystems share one Express server/port (3002) and one top nav bar,
but are otherwise fully separate in code: separate route files, separate
JSON "databases", separate frontend JS modules. This separation was an
explicit, repeated user requirement ("don't mix up the two projects") -
preserve it when adding subsystem #3, #4, etc.

## Who the user is / how they operate (important context)

- Non-developer, runs this on a home Windows PC (older hardware - i5 4th
  gen / 8GB RAM was mentioned as a target), for personal/student use.
- Interacts via `.bat` files (install.bat, start.bat, stop.bat, etc.) -
  not comfortable with a terminal beyond double-clicking things or
  pasting one command at a time.
- Located in Sri Lanka - relevant because some YouTube scraping issues
  are related to non-US IPs getting served different page variants
  (cookie-consent redirects, etc.) - always send a CONSENT cookie and
  gl=US/hl=en params on YouTube requests to sidestep this.
- Gets frustrated fast when things don't work and says so bluntly/
  profanely. This is not a signal to be defensive - stay calm, factual,
  and keep fixing. It IS a signal to actually test things thoroughly
  before shipping rather than guessing, and to be upfront when something
  genuinely couldn't be tested (see the PowerShell caveat below).
- Wants a **fresh full zip of the whole project every time**, not a diff
  or patch instructions. Always deliver `/mnt/user-data/outputs/*.zip`
  containing the complete, ready-to-run project.

## Critical technical lessons learned (do not repeat these mistakes)

1. **`express.static` was originally set to `maxAge: '1h'`.** This caused
   the user's browser to silently keep serving a stale cached copy of the
   entire site for up to an hour after every fix, making it look like
   nothing was ever fixed. This is now `maxAge: 0` in `server.js`. If you
   ever see caching-related "nothing I do matters" confusion again, check
   this first.
2. **A single `require()` at the top of a file can crash the ENTIRE
   server**, not just the feature that needed it. This happened when
   `@distube/ytpl` failed to install and was required at the top of
   `lib/youtube.js` - it took down plain video-adding too, and the whole
   site with it. Fix pattern used: lazy-`require()` inside the function
   that needs it, wrapped in try/catch, AND wrap each route module's
   require+mount in `server.js` in its own try/catch so one broken
   feature can't take down the others or static file serving.
3. **YouTube's playlist page HTML structure changes over time** and
   third-party scraper libraries (`@distube/ytpl`) lag behind. The
   current approach (see `lib/youtube.js`) tries THREE independent
   strategies in order and logs exactly what each one did:
   - `@distube/ytpl` library
   - Direct fetch + hand-rolled parsing of `ytInitialData` JSON embedded
     in the page - handles both the legacy `playlistVideoRenderer` shape
     AND YouTube's newer generic `lockupViewModel` shape (found via a
     real diagnostic session with the user - see `inspect-playlist.js`).
     Also follows pagination ("continuation tokens") to get videos beyond
     the first ~100 that the initial page HTML includes.
   - YouTube's public RSS feed (`/feeds/videos.xml?playlist_id=...`) -
     stable/official but capped at ~15 most recent videos, used only as
     a last resort, and the result is marked `partial: true` so the UI
     can tell the user.
   When YouTube changes things again (it will), the diagnostic scripts
   `test-playlist.js` and `inspect-playlist.js` (both at the project
   root, runnable directly with `node <script> "<playlist-url>"`) are the
   way to get real data from the user's machine rather than guessing.
   `inspect-playlist.js` specifically scans the ENTIRE page JSON for any
   key name that looks video/playlist/item-related (not a fixed
   guess-list), which is what found `lockupViewModel` last time.
4. **Real YouTube video IDs are always exactly 11 characters** (regex
   `^[\w-]{11}$`). Test fixtures with fake shorter/longer IDs will
   silently fail validation - this bit us once during testing (not a
   real bug, but easy to reproduce accidentally).
5. **`fs.unlink` (async, fire-and-forget) is unreliable for
   cleanup-then-verify logic** - there's a race where a check right after
   calling it can see the file as still present. Both AirDrop's TTL
   cleanup and tute deletion now use `fs.unlinkSync` deliberately.
6. Every backend change in this project has been tested via constructing
   realistic fixtures and either (a) monkey-patching `global.fetch` to
   return synthetic YouTube-shaped responses and running the real
   pipeline end-to-end, or (b) starting the real server as a subprocess
   and hitting it with real HTTP requests. This is the standard to keep
   meeting for anything touching `lib/youtube.js`, `routes/*.js`, or
   `lib/airdrop-store.js`. **Always restore the user's real `data/db.json`
   / `data/airdrop.json` after testing** - never ship test data.
7. **Never toggle visibility of a process's OWN console window for a
   "show me the logs" feature.** v0.1.1/v0.2.0/v0.2.1's tray app did
   exactly this (hide/show the tray's own console via `ShowWindow`) and
   it was the real cause of user-reported instability: closing that
   console via its native `[X]` button terminates the whole hosting
   process (the tray + server with it), not just "the console." Fixed in
   v0.2.2 by never showing the tray's own window at all - "Console"
   instead spawns a completely separate, disposable PowerShell process
   that tails `logs.txt`. Closing that window is inherently harmless
   because it's a different process. If a future session is tempted to
   "simplify" this back to a single-process show/hide toggle, don't -
   that's reintroducing the exact bug that was fixed.
8. **`Register-ObjectEvent`/`Register-EngineEvent` action blocks run in a
   detached scope** that can't reliably see the defining script's own
   variables/functions - unlike native .NET/WinForms event handlers
   (`Add_Click` etc.), which DO run as normal closures over their
   defining scope. Use `-MessageData` + `$Event.MessageData` to pass
   data into the former; don't rely on `$using:` (that's for
   `Invoke-Command`/`Start-Job`/`ForEach -Parallel`, not these) or on
   calling back into script-scope functions from inside them - write
   those handlers fully self-contained instead.
9. **cmd.exe does not support backslash-escaping of quotes** - that's a
   C/Unix convention. A multi-line, multi-argument `powershell -Command
   ^ "..." ^ "..."` block mixing this in is fragile and was a real,
   caught-before-shipping bug in an early v0.2.2 draft (fixed by moving
   that logic into a proper standalone `.ps1` file instead -
   `create-shortcuts.ps1`). Prefer a real `.ps1` file over inline
   batch-escaped PowerShell for anything beyond a single simple
   expression. (A single-line, single escaped-quote-pair pattern like
   `powershell -Command "Get-CimInstance ... -Filter \"Name='x'\" ..."`
   IS a known-working idiom that's been used successfully since v0.1.1 -
   the failure mode is specifically multi-line/multi-argument constructs,
   not escaped quotes in general.)
10. **`Start-Process -ArgumentList` mangles manually-embedded quotes when
    the underlying path contains a space** - shipped in v0.2.2, reported
    by the user with a real path (`C:\Users\...\DEX labs\logs.txt`,
    space before "labs"), reproduced the exact error, fixed in v0.2.2's
    follow-up by switching to `-EncodedCommand` (base64-encode the whole
    script as UTF-16LE, pass that instead of a quoted `-Command` string).
    This sidesteps shell-quoting entirely rather than trying to get the
    quoting "more correct" - prefer this approach any time a spawned
    PowerShell process needs a script string built from variables that
    might contain spaces/quotes.
11a. **PowerShell 5.1's default `SecurityProtocol` can be TLS 1.0**,
    which GitHub's API/CDN reject outright - any `Invoke-RestMethod`/
    `Invoke-WebRequest` call to `api.github.com` or
    `github.com`/`objects.githubusercontent.com` (release asset
    downloads) needs
    `[Net.ServicePointManager]::SecurityProtocol = ... -bor [Net.SecurityProtocolType]::Tls12`
    set first (done once, near the top of `tray.ps1`, before the
    auto-update handlers). Without it the failure looks exactly like "no
    internet," which wastes time misdiagnosing.
11. **The Update path and the fresh-install path must both produce the
    same result.** v0.2.2 initially only created the tray icon +
    Desktop/Start Menu shortcuts in `install.bat` - anyone who updated via
    the tray's Update menu (the expected normal path going forward) never
    got them, since `apply-update.ps1` didn't call that logic. Fixed by
    moving icon/shortcut generation into `apply-update.ps1` itself (the
    shared update logic), so it runs after every update regardless of
    which entry point triggered it. General principle: anything
    `install.bat` sets up that isn't pure one-time-only (firewall rule,
    icon, shortcuts) should also be refreshed by the update path, not
    just the initial install path.

## Versioning

Reached **v1.0.0** (dropped the "Pre Release" label from all display
strings - `server.js`'s boot log, `public/js/app.js`'s footer, and
`tray.ps1`'s `$DisplayLabel`). If continuing version bumps upward from
here, use plain semver (`1.1.0`, `1.2.0`, etc.) without the "Pre Release"
qualifier, since that phase is over per the user's explicit request to
move to a real 1.0.0 release for GitHub.

## The one area that could NOT be tested this way

The system tray app (`tray.ps1`), the shared update script
(`apply-update.ps1`), and `update.bat` are Windows-only (PowerShell +
.NET WinForms/Drawing, no npm dependencies by design - see "why no native
npm tray package" below). **The sandbox this was built in has no Windows
and no PowerShell**, so none of this could be executed or verified the
way everything else in this project has been. It was written carefully
against well-documented PowerShell/.NET patterns, with particular care
around a real gotcha: `Register-ObjectEvent`/`Register-EngineEvent`
action blocks run in a detached scope that can't reliably see the
script's own variables/functions (unlike native WinForms `Add_Click`
handlers, which DO run as normal closures) - this is handled via
`-MessageData`/`$Event.MessageData` for the process-output capture, and
by making the exit-safety-net handler fully self-contained rather than
calling back into script functions.

**If you're picking this project back up and the user reports tray/
update issues**, that's the most likely place bugs remain. `debug.bat`
(runs `node server.js` directly and visibly, no tray at all) is the
documented fallback and still works independently of any tray issues -
point the user there first if the tray itself won't start, then debug
the PowerShell from their actual error output (which will be new,
real information, the same way `test-playlist.js`/`inspect-playlist.js`
output was for the YouTube parsing work).

### Why no native npm tray package

Explicitly avoided adding an npm package like `node-tray`/`systray` with
native/compiled bindings, on purpose - this project has a running theme
of avoiding anything that could fail to install on the user's older
Windows machine (see the `@distube/ytpl` saga above; also `db.js` was
originally written to avoid native modules for the same reason). A
PowerShell + built-in .NET WinForms/System.Drawing script needs nothing
beyond what's already on any Windows install, including generating the
tray icon itself at runtime (drawn via `System.Drawing`, cached to
`tray-icon.ico`) rather than shipping a binary icon asset.

## Versioning scheme

Now at **`"1.0.0"`** in `package.json`, displayed plainly as
**"DEX Labs vX.Y.Z"** everywhere (no qualifier prefix). History: started
as plain semver 1.0.0→1.5.0, then the user asked for a "Pre Release
0.x.x" scheme for the tray-app development phase (0.1.1→0.2.2), then
asked to move to a real 1.0.0 for a GitHub release once the tray
stabilized - see the newer "## Versioning" section elsewhere in this
file for the current, authoritative state. Version is read from
`package.json` at runtime in `server.js` (`VERSION` const) and exposed
via `GET /api/server-info`, shown in the page footer, and used by the
update system's newer-version check (simple dot-split numeric
comparison, see `Test-VersionNewer` in `tray.ps1`).

## The update system, end to end

- **`apply-update.ps1` is the single mechanical core** (backup → extract-
  except-data-folders → npm install → refresh icon/shortcuts), with ZERO
  knowledge of where the zip came from or whether it's newer - that
  decision-making lives entirely in the caller. This separation is exactly
  why adding auto-update didn't need to touch this file at all - only new
  callers were added.
- **Three callers feed it now**, all in `tray.ps1`:
  - **Background timer** (`Invoke-BackgroundUpdateCheck`, added v1.0.4) -
    a `System.Windows.Forms.Timer` (`$updateTimer`, `$UpdateCheckIntervalMs`
    = 5 minutes) ticks this function. It checks GitHub via
    `Get-DexLatestReleaseInfo`, and if a strictly-newer version exists AND
    `Test-DexSystemIdle` says nothing is running, downloads and installs
    it via `Install-DexUpdateFromDownloadedZip -RelaunchTray` with **zero
    confirmation dialogs** (nobody may be at the PC) - only a balloon tip
    before installing and (on failure only) one after. If busy, it logs
    once per newly-seen version and retries next tick rather than nagging
    every 5 minutes. Toggle: `$script:AutoUpdateEnabled`, backed by
    `data\config.json`'s new `autoUpdate` boolean (`Get-DexConfig`/
    `Set-DexConfigAutoUpdate`), default `$true`, exposed as a checkable
    `$menuUpdateToggle` item in the Update submenu.
  - **Check for Updates (Auto)** (`$menuUpdateAuto`'s click handler) -
    same `Get-DexLatestReleaseInfo`/`Install-DexUpdateFromDownloadedZip`
    helpers as the background timer, but interactive: shows the version
    comparison and a Yes/No confirm before downloading, and does NOT pass
    `-RelaunchTray` (cycles the Node child process in place, same as
    always - a person is right there watching it, no need for the full
    tray relaunch).
  - **Select Update File (Manual)** (`$menuUpdateManual`'s click
    handler) - the original v1.0.2 behavior, untouched: an
    `OpenFileDialog`, then straight to `apply-update.ps1` with an
    in-place server restart.
  - `update.bat` (command-line path) is unchanged/manual-only - never was
    part of any auto-update ask.
- **"Only auto-update when no timer or any subsystem is running"**
  (`Test-DexSystemIdle`, v1.0.4) checks two things: (a) `data\timers.json`
  read directly (local file, no round-trip) for any timer with status
  `running`/`ringing`; (b) `GET http://localhost:<port>/api/busy` on the
  live server, which reports in-flight AirDrop/Lesson-Tracker tute
  uploads (tracked by a small `activeUploads` counter middleware added to
  `server.js`, incremented/decremented around any POST request whose path
  matches `/upload` or `/tutes`) plus `timersStore.countActive()` (a
  function that already existed for the 10-active-timer cap, reused
  rather than duplicated). If the server can't be reached at all, that's
  treated as NOT idle - safer to skip a cycle than update under something
  unverifiable. This is a deliberately narrow definition of "subsystem
  running" - it does not attempt to detect "someone has a browser tab
  open" or "someone is mid-edit on the Daily Schedule form," since there's
  no session-tracking in this app to know that. If the user wants a
  broader definition later, that would need real session/activity
  tracking added first - flag this clearly rather than silently expanding
  scope.
- **The "restart the whole system" full relaunch** (`Restart-DexTrayProcess`,
  v1.0.4) is distinct from the everyday `Stop-DexServer`/`Start-DexServer`
  pair (which only cycles the Node child process, still inside the same
  tray.ps1 host process). This one actually closes the current tray.ps1
  process and launches a brand new one via `wscript.exe run-hidden.vbs`
  (the same mechanism the Desktop/Start Menu shortcuts use), then calls
  `[System.Windows.Forms.Application]::Exit()` on itself. Only the
  background timer path uses this (`-RelaunchTray` switch on
  `Install-DexUpdateFromDownloadedZip`); the manual Auto-check keeps the
  lighter in-place restart since a person is present to notice if
  something looked off.
- **Update zips must have `package.json` at the zip ROOT** (not nested
  inside a subfolder) - all three tray callers and `update.bat` read
  `package.json` directly from the zip root to check the version before
  doing anything. When producing a new release zip, zip the *contents* of
  the project folder, not the folder itself. For the auto paths
  specifically: **the GitHub Release's tag should be the version number**
  (`v1.0.4` or `1.0.4`, either accepted - leading `v` stripped before
  comparing), and the release needs a `.zip` file attached as a release
  asset (not a source-code auto-tarball - only assets named `*.zip` are
  considered).
- **Data is always backed up before anything else happens**, to
  `backups/backup-<timestamp>/`, containing copies of `data/`, `uploads/`,
  and `uploads-airdrop/`. This happens unconditionally as the very first
  step of `apply-update.ps1`, before any existing files are touched -
  the user was explicit that the database must never be at risk. True for
  all three update paths, since they all end up at the same
  `apply-update.ps1`.
- The update is refused (with a clear message, nothing changed) if the
  new version isn't strictly greater than the currently installed one -
  same `Test-VersionNewer` function backs every path.
- **Not tested end-to-end for the Windows-only parts** for the same
  reason as the rest of `tray.ps1`/`apply-update.ps1` (see "the one area
  that could NOT be tested" below) - no Windows/PowerShell in this
  sandbox, so `Invoke-RestMethod`/`Invoke-WebRequest` against the real
  GitHub API, the WinForms `Timer`, `ShowBalloonTip`, and the
  wscript/run-hidden.vbs relaunch have not been exercised live. **What
  WAS tested for real** (v1.0.4): the new `GET /api/busy` endpoint and
  its `activeUploads` tracking middleware in `server.js` - verified with
  the real server as a subprocess, hit with real HTTP requests: confirmed
  `busy: false` while idle, `busy: true` with the correct reason string
  while a timer was running (via real `POST /api/timers`), `busy: true`
  with `"1 file upload in progress"` while a 50MB AirDrop upload was
  literally mid-transfer (checked via a concurrent poll during the
  upload), and back to `busy: false` immediately after. If the user
  reports a background-update problem, get their exact `logs.txt`
  lines/balloon text first rather than guessing, same methodology as
  everything else Windows-only in this project.

## Known limitations / things not yet done

- Auto-update from GitHub: **built in v1.0.3, extended to a background
  5-minute checker in v1.0.4** - see the updated "update system" section
  above. `update.bat` (command line) is still manual-only by design (no
  interactive submenu there).
- The "no subsystem running" idle check (v1.0.4) only covers in-flight
  uploads and active timers - it does NOT know whether someone has a
  browser tab open on the site, or is mid-edit on the Daily Schedule
  grid, since there's no session/activity tracking in this app. If the
  user wants that broadened, it needs real session tracking added first,
  not just a wider guess.
- AirDrop's 30GB cap check happens *after* multer has already streamed
  an oversized upload fully to disk (then deletes it) - wastes I/O on a
  rejected oversized upload but keeps the accounting simple/correct.
  Fine at this scale; would need a pre-flight `Content-Length` check to
  do better, not worth the complexity yet.
- Continuation pagination for large playlists is capped at 30 pages
  (~3000 videos) as a sanity limit - essentially never hit in practice.
- No automated test suite / CI - all testing so far has been manual,
  ad-hoc, but thorough (see "critical lessons" above for the methodology
  used). If this project grows much further, consider setting up a real
  test file structure.

## File layout

```
server.js                  entrypoint - mounts routes, starts listening,
                            wraps each route module's require+mount in
                            try/catch so one broken feature can't kill
                            the others; also tracks in-flight uploads and
                            exposes GET /api/busy (v1.0.4, used by the
                            tray's background auto-update idle check)
db.js                      tiny JSON-file DB helper for Lesson Tracker
                            (read/update/genId/slugify) - data/db.json
lib/youtube.js              all YouTube reading logic (video meta via
                            oEmbed, playlist via 3-strategy fallback,
                            on-demand video details/description)
lib/airdrop-store.js         AirDrop's own tiny JSON-file DB (separate
                            from db.js on purpose) - data/airdrop.json,
                            1hr TTL cleanup, 30GB session cap tracking
lib/schedule-store.js         Daily Schedule's own tiny JSON-file DB -
                            data/schedule.json, no dates/rotation logic
lib/timers-store.js            Clock's Timer/Alarm DB - data/timers.json,
                            the 1-second server-side tick loop that flips
                            expired timers to "ringing" and triggers the
                            server-side beep (v1.1.1: a synthesized WAV
                            played via System.Media.SoundPlayer, spawned
                            as a PowerShell child process - reaches
                            Bluetooth output, unlike the old
                            [console]::beep)
lib/stopwatch-store.js          Clock's Stopwatch DB (v1.1.1) -
                            data/stopwatch.json, no tick loop needed
                            (elapsed = stored timestamps + wall clock)
lib/study-store.js               Study's DB (v1.1.5) - data/study.json:
                            subjects, saved sessions, the one active
                            session (Stopwatch/Pomodoro, same no-tick-
                            loop timestamp-math design as Stopwatch),
                            Pomodoro settings (saved forever, frozen
                            into each session at start time), manual
                            day-logs, and stats/heatmap aggregation
routes/lessons.js            subjects, categories (rename/add/delete),
                            lessons (add/watched-toggle/delete/details),
                            tutes (upload/download/delete)
routes/airdrop.js             upload/list/download/delete, enforces the
                            30GB session cap
routes/schedule.js             GET/PUT the 3x3 schedule grid
routes/timers.js                 Clock's router (still one router/one
                            mount, /api/timers): list/create/dismiss/
                            delete for Timer+Alarm (enforces the
                            10-active cap) PLUS (v1.1.1) Stopwatch's
                            /stopwatches sub-routes, same file/same mount
routes/study.js                   Study's router (v1.1.5, /api/study) -
                            subjects, active-session control (start/
                            pause/resume/cancel/finish), settings,
                            day-logs, stats
public/index.html              page shell, top nav (DEX Labs brand +
                            subsystem switcher + LAN address button)
public/js/app.js                Lesson Tracker frontend (router, all
                            views, modal helper, toast helper)
public/js/airdrop.js             AirDrop frontend (fully separate module,
                            only shares the page shell/toast element)
public/js/schedule.js             Daily Schedule frontend (same isolation
                            pattern as airdrop.js)
public/js/timers.js                Clock frontend - Timer/Alarm/
                            Stopwatch tab shell + all 3 menus, polls the
                            server every 1s, renders circular SVG rings
                            (countdown for Timer/Alarm, a continuously
                            CSS-spinning arc for Stopwatch), plays a
                            bonus browser-side beep (Web Audio) on top of
                            the real server-side one for Timer/Alarm
public/js/study.js                  Study frontend (v1.1.5) - Study/
                            Stats/Calendar tab shell, self-contained
                            same as every other subsystem module, own
                            SVG ring/pie/heatmap building, polls the
                            active session every 1s, browser-side
                            Web Audio beep on Pomodoro phase change
public/css/style.css              Lesson Tracker + shared/global styles
public/css/airdrop.css             AirDrop-specific styles (own accent
                            color, prefixed .airdrop- classes)
public/css/schedule.css              Daily Schedule styles (own amber
                            accent, prefixed .schedule- classes)
public/css/timers.css                 Clock styles (own teal accent,
                            circular ring SVG styling shared by Timer/
                            Alarm/Stopwatch, plus the .clock-tabs menu)
public/css/study.css                   Study styles (v1.1.5, own indigo
                            accent, prefixed .study- classes, heatmap
                            grid styling)
tray.ps1                     system tray app (Console/Update [Auto+
                            Manual+background-timer toggle submenu]/
                            Settings/Exit)
apply-update.ps1              shared update logic (backup/extract/install)
update.bat                    command-line update entry point
clear-port.bat                  shared helper: frees port 3002 and kills
                            duplicate tray instances - called by every
                            launch path (install/start/debug/update/tray)
install.bat / start.bat /      setup and lifecycle scripts
  stop.bat / uninstall.bat /
  debug.bat / run-hidden.vbs
test-playlist.js              standalone playlist-read diagnostic
inspect-playlist.js            standalone YouTube-page-structure diagnostic
data/db.json                  Lesson Tracker's actual data - PRESERVE
data/airdrop.json               AirDrop's data (ephemeral, safe to reset)
uploads/                      tute files, organized by subject folder
uploads-airdrop/                AirDrop's files (ephemeral, 1hr TTL)
backups/                      auto-created by the update system
landing-page/                  the Landing Page - own Node process, own
                            port (80), own data (landing-page/data,
                            specially preserved across updates - see
                            apply-update.ps1), but its lifecycle
                            (install/start/stop/watch) is now managed by
                            tray.ps1/install.bat/apply-update.ps1 as of
                            v1.1.4 - see CHANGES.md's v1.1.3 AND v1.1.4
                            sections, and landing-page/README.md
```

## How to keep working on this

- Read this whole file first.
- Check `data/db.json` to see the user's real current subjects/lessons -
  don't overwrite it with test data; always restore it after testing.
- For anything touching YouTube parsing: test with synthetic
  `global.fetch` mocks matching real observed structures (see lessons
  learned #3/#6 above) before shipping - don't guess blind.
- For anything Windows/PowerShell-only: be explicit with the user that
  it's untested by you directly (no Windows/PowerShell available), ask
  for their exact output/error if something goes wrong, and fix from
  real data the same way the playlist parser was fixed.
- Always deliver a complete fresh zip via `present_files`, with
  `package.json`'s version bumped and the zip contents at zip-root (no
  wrapping folder) if the update system needs to consume it.

## v1.1.0 merge (for future sessions)

v1.1.0 combined two change sets built in separate sessions: a new
**⬇ YouTube Downloader** subsystem (own `lib/ytdownload-store.js` +
`routes/ytdownload.js` + `public/js/ytdownload.js`/`.css`, drives
`yt-dlp` as a child process, downloads land in `downloads-youtube/`, its
own managed `yt-dlp`/`ffmpeg` copies live in `tools-youtube/`), and a
crash-restart watchdog + forced AirDrop setup + update banner + a
generic subsystem show/hide registry (`lib/subsystems-registry.js` +
`window.DexSubsystems` self-registration convention in
`public/js/app.js`'s `route()`). See `CHANGES.md` for the full
file-by-file breakdown of both parts and the merge itself.

The one thing the merge added that neither original session could see
from its own side: `GET /api/busy` (used by the tray's watchdog/
auto-updater to avoid restarting mid-transfer) didn't know about
in-progress YouTube downloads until this merge added
`ytdownloadStore.countActive()`, mirroring the existing
`timersStore.countActive()`. If a 6th+ subsystem ever has its own
long-running server-side work (not just a browser file upload), check
whether it needs the same treatment.

Still unverified on real Windows: everything in `tray.ps1`, across every
version - no Windows/PowerShell has been available in any session that
built or merged this project. This remains the single highest-value
thing to test for real before fully trusting any future release.

## v1.1.5 (for future sessions)

**New subsystem: Study** - full write-up (including the exact math and
test evidence) is in `CHANGES.md`'s v1.1.5 section; quick pickup summary:

- Files: `lib/study-store.js` (all the logic/data), `routes/study.js`
  (mounted at `/api/study`), `public/js/study.js` (self-contained
  frontend, 3 tabs: Study/Stats/Calendar), `public/css/study.css` (own
  indigo accent). Registered in `lib/subsystems-registry.js` as
  `id: 'study'`. `data/study.json` holds subjects, saved sessions, the
  one active session (if any), manual day-logs, and Pomodoro settings.
- **The active session is server-authoritative with NO tick loop** -
  same design as `lib/stopwatch-store.js`: elapsed/phase time is pure
  math off stored timestamps + wall clock, computed fresh on every
  read (`computeActiveView` in `lib/study-store.js`). This is also why
  Study needed no `GET /api/busy` entry, same reasoning as Stopwatch.
- **Pomodoro study/rest minutes are saved forever, and a running/saved
  session can never be retroactively changed by editing them** - a
  session copies `pomodoroStudyMin`/`pomodoroRestMin` off `settings`
  the instant it starts (`startSession`) and never reads `settings`
  again. If a future session touches Pomodoro settings, preserve this -
  it was an explicit, repeated user requirement.
- **A Pomodoro session's "hours actually studied" excludes rest-phase
  time** - `studiedMsForPomodoro()` computes this from elapsed time and
  the session's own frozen study/rest minutes, used both for the live
  `studiedMs` shown during the session and for what actually gets
  saved into `sessions[]` when it's finished.
- **A day with a real study session can never be overwritten by a
  manual Slept/Did-nothing mark** (`setDayLog` refuses if a session
  already exists for that date) - the auto-derived "studied" status
  can't drift out of sync with real session data.
- **`app.js`'s generic subsystem dispatch now forwards the second hash
  segment** (`generic.render(parts[1])` instead of `generic.render()`)
  so a subsystem with its own internal sub-tabs (Study's Study/Stats/
  Calendar, same shape as Clock's Timer/Alarm/Stopwatch) works through
  the *generic* `window.DexSubsystems` path without needing its own
  special case in `route()` the way Clock has. **If a future subsystem
  needs its own sub-tabs, it should just work through this same generic
  path now** - no more app.js edits needed for that specific problem.
- Tested via the real server as a subprocess + real HTTP requests (see
  CHANGES.md's v1.1.5 section for the specific scenarios covered,
  including the settings-freeze guarantee and the multi-cycle Pomodoro
  phase math verified with simulated elapsed times). **Not tested**:
  real browser Web Audio playback of the Pomodoro phase-change beep -
  no audio hardware in this sandbox, same standing limitation as every
  other browser-side beep in this project.

## v1.1.4 (for future sessions)

**Hotfix notes (same v1.1.4, zip re-packaged twice)** - full write-up in
`CHANGES.md`'s two hotfix sections, but the CRITICAL lesson for any
future session touching `apply-update.ps1` is this:

**`apply-update.ps1` is invoked as `$AppRoot\apply-update.ps1` -
whatever's ALREADY on disk, not the copy sitting inside the new zip
being applied.** A fix that only lives inside the new zip's copy of
`apply-update.ps1` **can never take effect during the one update that
needed it** - by the time that fix is "live," the update it would have
helped has already run (using the OLD, unfixed script). This was
discovered the hard way: hotfix #1 added a "stop anything on the Landing
Page's port before replacing that folder" step to fix the v1.1.3 ->
v1.1.4 upgrade specifically, and it did nothing, because the v1.1.3
version of `apply-update.ps1` - not the fixed one - is what actually ran.

**What DOES work, and is now in place (hotfix #2)**: making the
folder-replace loop resilient PER ITEM (retry-with-backoff, then skip
and continue) rather than one big try/catch around everything. This
works even when invoked by an old, unaware script, because the fix lives
in *how remaining items are processed after one fails*, not in something
that needs to run before the failure. Before this, a single locked
folder (`landing-page`, in this case - blocked by v1.1.3's old,
independently-running Landing Page process still using it as a working
directory) aborted the ENTIRE update immediately, leaving everything
alphabetically after it - `lib/`, `package.json`, `public/`, `server.js`,
`tray.ps1` - stuck on the old version. That's a much worse outcome than
"one folder didn't update," and it's the real reason hotfix #1's
symptom (tray still showing v1.1.3 after an "applied" update) looked
the way it did.

**If a future session ever needs to fix something that must run *during*
a specific old-version -> new-version transition**: it can't be done
purely by editing `apply-update.ps1`'s content for next time - that
migration-specific problem needs either (a) a resilient/retry design
that degrades gracefully no matter which old script runs it (the general
fix applied here), or (b) an explicit one-time manual step communicated
to affected users (which is what v1.1.3 -> v1.1.4 specifically still
needs: closing the old standalone Landing Page process by hand once,
e.g. `taskkill /F /IM node.exe`, before that one update can fully
succeed - there's no way to automate around a script that can't yet know
about the thing it needs to stop).


**Landing Page went from a separate standalone program (v1.1.3) to a
fully integrated part of DEX Labs' own install/update/tray lifecycle** -
explicit user request, reversing v1.1.3's "keep it completely separate,
own install script" approach for the *lifecycle management* (it's still
a separate Node process/port - see landing-page/server.js's own header
comment for why that part hasn't changed). Full detail in `CHANGES.md`'s
v1.1.4 section; quick pickup summary:

- `tray.ps1` now has `Start-DexLandingPage`/`Stop-DexLandingPage`
  (mirrors `Start-DexServer`/`Stop-DexServer` exactly), called alongside
  every existing call site of those two (startup, both update paths,
  Exit), plus its own watchdog check and a tray menu on/off toggle
  (`landingPageEnabled` in `data/config.json`, default true).
- **Admin permission (opening the firewall for port 80) is requested
  automatically, but only once and only when actually missing** -
  `Ensure-DexLandingPageFirewall` checks first, silently no-ops if the
  rule already exists. **This must never be called from the watchdog or
  the silent background auto-update timer** - only from
  `Start-DexLandingPage`'s normal call sites, which are always tied to
  an active/present user session. If a future session adds more to the
  Landing Page's startup path, keep that boundary - it's the whole
  reason the background auto-updater's "zero dialogs, nobody may be at
  the PC" guarantee (in place since v1.0.4) still holds.
- **`landing-page/data` needed special handling in `apply-update.ps1`**
  that a future session should remember if it ever adds another
  subfolder-with-its-own-data situation: the existing top-level
  `$excludeFolders` list (`data`, `uploads`, etc.) only protects folders
  that live directly under the project root. `landing-page/data` is
  nested one level inside a folder (`landing-page`) that itself gets
  wholesale-deleted-and-replaced on every update - so it needed its own
  explicit preserve-before/restore-after pair around that step, or every
  update would have silently wiped anyone's saved site list. **If a
  future session adds a new subsystem-with-its-own-data folder that
  lives inside a top-level folder that gets replaced wholesale, it needs
  this exact same treatment - being top-level in `$excludeFolders` is
  not enough if the data itself isn't also top-level.**
- `install.bat` itself needed no functional changes - it already ends by
  launching `tray.ps1`, which now handles the Landing Page (including
  the one-time permission request) entirely on its own.
- Migrating existing v1.1.3 users cleanly required three separate fixes,
  all in `apply-update.ps1`: preserving `landing-page/data` (above),
  removing the old standalone `DexLabsLandingPage.vbs` Startup shortcut
  (would otherwise race with the new tray-managed start), and making
  sure the firewall-rule check recognizes their already-granted rule so
  they're never asked twice.
- **No Windows available in the sandbox that built this** (standing
  limitation, same as `tray.ps1`/`apply-update.ps1` generally) - the
  `.ps1` changes were reviewed carefully (brace/paren balance, full
  re-read, checked specifically against the `Start-Process -ArgumentList`
  space-in-path bug from the v0.2.2 lessons below) but not executed
  end-to-end. If the user reports an issue with the permission prompt,
  the toggle, or the watchdog, get their exact `logs.txt` text first.

## v1.1.3 (for future sessions)

**New: `landing-page/` - a completely separate, standalone program**,
not a DEX Labs subsystem. It's a tiny zero-dependency Node server bound
to port 80 that lists whatever websites are running on this computer
(DEX Labs itself pre-seeded, plus anything else the user adds through the
page itself) so that typing just the computer's IP address - no port -
shows a clickable menu instead of "this site can't be reached". Full
detail, including a real bug caught before shipping (validating input
*inside* a store's `update()` mutator can permanently poison that
store's write-queue - see `lib/sites-store.js`'s big warning comment
above `update()`), is in `CHANGES.md`'s v1.1.3 section and
`landing-page/README.md`.

**Why this lived entirely outside the rest of the codebase at this
point** - explicit user requirement, not an arbitrary architecture
choice: it must keep working even when DEX Labs' own server (port 3002)
is stopped/crashed/mid-update, and it must be completely invisible
from/unreachable through that port-3002 site. So: own process, own port,
own data file, own install/start/stop scripts, never touched by
`server.js`, `lib/subsystems-registry.js`, or any nav code.

**Update (v1.1.4): the *lifecycle management* (installing, starting,
stopping, watching) was later folded into `tray.ps1`/`install.bat`/
`apply-update.ps1` per a later explicit request - see `CHANGES.md`'s
v1.1.4 section. The standalone `.bat`/`.vbs` files mentioned below no
longer exist.** What did NOT change, and still must not: it's still a
genuinely separate Node **process** on its own **port** (80), still
never mounted inside `server.js` or added to
`lib/subsystems-registry.js`/nav. Those two guarantees (keeps working if
port 3002 is down; invisible from the port-3002 site) are what actually
mattered and are preserved - "no separate install step for the user" and
"still architecturally separate under the hood" turned out to not be in
tension with each other.

If the user reports the Landing Page won't start, it's almost always
port 80 already being claimed by something else on their PC (commonly
Windows' own IIS/"World Wide Web Publishing Service") -
`landing-page/README.md` has the full walkthrough. Like `tray.ps1`
elsewhere in this project, the Windows-side scripts here are unverified
on real Windows (no Windows in the sandbox that built this) - get the
user's exact error text from `logs.txt` (Console menu item) rather than
guessing if something's off.

## v1.1.2 (for future sessions)

Four bug fixes, no new features - see `CHANGES.md`'s v1.1.2 section for
full detail. Quick summary for a fast pickup:

1. **Stopwatch/Timer/Alarm grid now centers a single card** - was
   `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))` in
   `public/css/timers.css`; `auto-fill` always reserves empty tracks to
   fill the row, so one card sat left-pinned. Now `auto-fit` +
   `minmax(160px, 200px)` (capped, not `1fr`) + `justify-content: center`.
2. **Fixed the Stopwatch ring "only spins ~70%, snaps back" bug** - the
   real root cause was `renderStopwatchCards()`/`renderTimerOrAlarmCards()`
   in `public/js/timers.js` fully replacing `wrap.innerHTML` on every 1s
   poll, destroying and recreating every card's DOM node (ring `<circle>`
   included) faster than the ring's own 1.6s CSS spin animation could
   complete a lap. Fixed with a generic in-place list reconciler
   (`reconcileGrid()`) - card DOM nodes now persist across polls and only
   their changed parts (text, state classes, buttons, laps) get updated;
   the ring node itself is never touched after creation, so its CSS
   animation just runs continuously like a real spinner. **If a future
   session touches Timer/Alarm/Stopwatch rendering again, keep using this
   reconciler pattern - reverting to a full innerHTML replace on every
   poll tick will silently reintroduce this exact bug** (any CSS
   animation on a repeatedly-recreated node breaks the same way, not just
   this one).
3. **Alarm/timer beep turned up** - `ringServerBeep()` in
   `lib/timers-store.js` was synthesizing its WAV at only ~37% of full
   16-bit PCM amplitude (`+/-12000` of `+/-32767`); now ~98%
   (`+/-32000`), plus a slightly longer beep (500ms vs 350ms). Still
   unverified on real Windows/Bluetooth hardware - if the user reports
   it's still too quiet, `$freq`/`$durMs`/`$reps` in that function are the
   next things to tune.
4. **"What's new" update banner now actually renders Markdown** instead
   of showing it literally (`**`, `#`, `- ` etc. were showing up as raw
   characters). Added a small dependency-free Markdown→HTML converter
   (`renderMarkdownLite()` in `public/js/app.js`) - escapes first, then
   wraps the escaped (inert) text in real tags, and only allows `http(s)`
   link targets. If a future release's notes use Markdown syntax this
   converter doesn't cover (tables, nested lists, etc.), it'll just show
   as literal text for that part rather than breaking - extend
   `renderMarkdownLite()` rather than reverting to raw escaped text.

## v1.1.1 (for future sessions)

Two changes, both scoped entirely inside the subsystem whose id is
`timers` (registry id never renamed - see `lib/subsystems-registry.js`):

1. **Renamed "Timers" -> "Clock" and added a Stopwatch menu.** Explicit
   user requirement: still exactly **one subsystem**, not three - Timer/
   Alarm/Stopwatch are 3 menus (a tab control) inside that one
   subsystem, all served by the same `public/js/timers.js` and the same
   `routes/timers.js` router (new `/stopwatches` sub-routes added to the
   existing router, no new `server.js` mount block). Stopwatch has its
   own store file (`lib/stopwatch-store.js`, `data/stopwatch.json`) for
   the same "own file per concern" reason everything else in this
   project does, but that's a code-organization choice, not a second
   subsystem. See CHANGES.md's v1.1.1 section for the full breakdown,
   including why Stopwatch doesn't need a tick loop (pure elapsed-time
   math off stored timestamps) or a `GET /api/busy` entry (nothing
   in-flight to protect, unlike Timer/Alarm's tick loop or YouTube
   Downloader's child process).
2. **Fixed the server-side alarm beep going silent over Bluetooth.**
   `ringServerBeep()` in `lib/timers-store.js` no longer uses
   `[console]::beep()` (a legacy Win32 API that doesn't reliably route
   through the normal Windows audio mixer / default-playback-device
   selection) - it now synthesizes a WAV in memory and plays it via
   `System.Media.SoundPlayer`, which does follow the real default
   playback device, Bluetooth included. Falls back to the old
   `[console]::beep()` inside the same script's `try/catch` if
   `SoundPlayer` itself throws, so this can't regress to total silence.
   **Not verified on real Windows/Bluetooth hardware** - if the user
   reports it's still silent after this update, that's the next thing to
   debug for real, same methodology as everything else Windows-only in
   this project (get their exact `logs.txt` output, don't guess blind).
