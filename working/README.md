# DEX Labs

A private personal website that runs on your own Windows PC and is
reachable from any phone or PC on your home WiFi. No cloud, no accounts,
no internet exposure - everything stays on your own network.

DEX Labs itself is just a shell; the actual features are independent
**subsystems** plugged into it, switchable from the top nav bar:

> **Note on this repo's zip layout:** the top-level folder also
> contains a `landing-page/` directory - the standalone "🏠 Websites on
> this computer" page (its own `server.js`, `lib/`, `public/`, own port
> 80 process). It is a genuinely separate program from DEX Labs itself
> (see `landing-page/README.md` for why), NOT one of the "subsystems"
> listed below, and does not appear in `lib/subsystems-registry.js` -
> features for it get added directly under `landing-page/`, not
> registered as a DEX Labs subsystem. Because `landing-page` sorts
> alphabetically before `package.json` in most zip viewers/`unzip -l`
> output, it's easy to glance at a listing, see `landing-page/...` at
> the top, and wrongly conclude the archive has no `package.json` at
> its root or that DEX Labs' real root is nested somewhere. It isn't -
> `package.json`, `server.js`, `lib/`, `public/`, `routes/` for DEX Labs
> itself all sit directly at the archive root, as siblings of
> `landing-page/`, not inside it. If a future session (AI or human)
> packages a new version as a zip and something looks off about the
> root, check the FULL listing (`unzip -l file.zip`) rather than
> assuming from the first few sorted entries.
>
> Also worth knowing (v1.1.9): a "find other devices on the network"
> feature was briefly built as a DEX-Labs-subsystem page
> (`lib/netscan-store.js` / `routes/netscan.js` / `public/js/netscan.js`
> under the main DEX Labs tree) before being removed in favor of living
> inside `landing-page/` instead, as `landing-page/lib/discover.js` +
> `GET /api/discover` + the auto-scan loop in
> `landing-page/public/app.js`. That's the right home for it - it's
> fundamentally about "what other websites exist on this network,"
> which is exactly what the Landing Page already is. If asked for
> something similar again, build it there, not as a new subsystem.

- **📚 Lesson Tracker** — organize YouTube lesson videos and playlists by
  subject and category, track which ones you've watched, view full
  titles/descriptions, and upload/download files ("tutes") per subject.
- **⇄ AirDrop** — drop a file in from any device on the WiFi, grab it
  from any other device, auto-deletes after 1 hour. 30GB shared storage
  at any given time.
- **📅 Daily Schedule** — a simple 3-day study planner grid.
- **🕐 Clock** — one subsystem, 4 menus: **Timer**, **Alarm**,
  **Stopwatch**, and **Events** (countdowns to important dates). Up to 10
  of each at once, shown as circular timers/rings. When a timer or alarm
  goes off, the PC running DEX Labs beeps loudly through its own speakers
  (including Bluetooth speakers/headsets) - it's a real alarm, not just a
  silent website notification. Stopwatches run on the server too, so they
  keep correct time across page reloads or a server restart.
- **⬇ YouTube Downloader** — paste a video link, see real quality
  options (Max/Medium/Lowest/Audio-only) with accurate file sizes pulled
  straight from the video, pick one, and download it to this PC. Sets up
  its own copies of `yt-dlp`/`ffmpeg` automatically the first time it's
  used - nothing to install by hand.
- **📖 Study** — pick a subject and study it with a Stopwatch or a
  Pomodoro timer (study/rest minutes are saved and reused every time).
  See hours studied per subject as a pie/bar chart, how many days you
  Studied vs Slept vs Did nothing, and a GitHub-style year heatmap
  showing how much you studied on every day of the year.
- **🌙 Standby Mode** — a full-screen, always-on "ambient" view: big
  clock, next events, weather-style cards, host RAM/CPU stats, and
  today's to-dos.
- **✅ To-Do** — a ticking-off list (like GitHub's `- [ ]` checkboxes)
  you can schedule on calendar days, with done-items stamped with dates
  on the Study calendar.
- **📹 CCTV** — if you have a Hikvision DVR on the same WiFi, one tap
  finds it ("Find DVR automatically") and shows every camera's live feed
  as a responsive tile grid on any device - no login needed on DEX Labs.
  Tap a tile for full-screen HD with an SD/HD toggle and one-tap
  snapshots. Uses the same bundled `ffmpeg` as the YouTube Downloader to
  restream the DVR's RTSP feeds. Credentials (set once in Settings, or
  auto-discovered) are stored on this PC only.

Any subsystem can be hidden from the nav (and un-hidden later) via
**⚙ Settings** on the website or the tray's Settings menu, without
losing any of its data - see "Using the tray icon" and the Settings page
itself.

Every subsystem is independent by design - its own code, its own data
file, no cross-references - so any one of them can be worked on, or
removed, without touching the others. More are expected to be added
over time.

DEX Labs runs as a **system tray application**: a small icon near your
clock that manages everything, with a right-click menu for Console
(live log viewer), Update, Settings (currently: change the port), and
Exit.

---

## Requirements

- Windows 10/11
- [Node.js LTS](https://nodejs.org) (free, one-time install)
- That's it - everything else DEX Labs needs is either built into
  Windows (PowerShell, .NET) or installed automatically by `install.bat`.

## Installation

1. Install [Node.js LTS](https://nodejs.org) if you haven't already.
2. Download/clone this repository anywhere on your PC.
3. Double-click **`install.bat`**.

That's it. `install.bat` will:
- Install DEX Labs' dependencies (needs internet, one time)
- Open a Windows Firewall rule so other devices on your WiFi can connect
- Generate a tray icon and create **Desktop + Start Menu shortcuts**
- Set DEX Labs to auto-start (as a tray icon) whenever you log in
- Start it right now

Look for the DEX Labs icon in your system tray (bottom-right, near the
clock). Left-click it to open the site in your browser; right-click for
the full menu.

From another device on the same WiFi, open `http://<this-pc's-IP>:3002`
(install.bat prints the exact address, and it's also shown in the tray's
Console output).

## Using the tray icon

| Menu item | What it does |
|---|---|
| **Open DEX Labs** (or left-click) | Opens the site in your browser |
| **Console** | Opens a separate window showing live server output/logs - safe to close anytime, has no effect on the server |
| **Update** | Submenu: **Check for Updates (Auto)** looks at [the GitHub releases page](https://github.com/Dex-Dete/DEX-labs/releases) itself and installs the newest one if there is one; **Select Update File (Manual)** lets you pick a `.zip` by hand; **Auto-Update (checks every 5 min)** is a checkbox toggle for background auto-updating (see below). Either update path backs up your data automatically first, and refuses anything that isn't actually newer |
| **Settings** | Prompts in order: the port DEX Labs runs on, AirDrop's usage cap/save location (required once on first run before the site is usable), then a subsystem show/hide picker with a "show this first" choice - same settings as the website's own ⚙ Settings page, kept in sync with it |
| **Exit** | Fully stops DEX Labs |

## Updating

Your data is always backed up first, and an update is rejected if it
isn't actually newer than what you currently have.

**Background auto-update (on by default)** - DEX Labs checks
[github.com/Dex-Dete/DEX-labs/releases](https://github.com/Dex-Dete/DEX-labs/releases)
every 5 minutes on its own. If a newer version has been released, it
only installs it once nothing is actively going on - no timer/alarm
currently running or ringing, and no AirDrop/tute file upload currently
in progress - so it never interrupts something mid-flight. When it does
install, you'll see a brief tray notification ("DEX Labs has released
vX.X.X - you have vY.Y.Y, so it's time to update. Installing now...").
It then backs up your data, installs the update, and does a full restart
(closes the tray and its server, opens a fresh one) - the same as if
you'd manually closed and reopened DEX Labs. If DEX Labs is busy when a
new release shows up, it just waits and re-checks every 5 minutes until
things are idle.

Turn this off any time via **Tray icon → Update → Auto-Update (checks
every 5 min)** (unchecking it stops the background checks; the setting
is remembered across restarts). You can still update manually with
either of the options below regardless of this setting.

Three ways to update on demand:

- **Tray icon → Update → Check for Updates (Auto)** — asks GitHub what
  the latest release is right now, shows you the version comparison, and
  asks for confirmation before installing (unlike the background check,
  this one always asks first, since you're right there).
- **Tray icon → Update → Select Update File (Manual)** — pick a `.zip`
  yourself (e.g. one you downloaded ahead of time).
- **Command line**: run `update.bat` (double-click it, or
  `update.bat "C:\path\to\update.zip"`) — same manual flow as above.

Backups land in `backups\backup-<date>\`, kept until you delete them
yourself.

Releases are published as a `.zip` file attached to a GitHub Release at
[github.com/Dex-Dete/DEX-labs/releases](https://github.com/Dex-Dete/DEX-labs/releases).
For the auto-update check to find it, the release's Git tag should be
the version number (e.g. `v1.0.4` or `1.0.4`), and the `.zip` attached
to it must have `package.json` at its root (not nested in a folder) -
same requirement as manual update zips.

## Uninstalling

Run **`uninstall.bat`**. This removes auto-start, the shortcuts, and the
firewall rule. **Your data is never deleted** - it's still sitting in
the `data`, `uploads`, `uploads-airdrop`, `downloads-youtube`, and
`tools-youtube` folders; delete the whole application folder yourself if
you want to remove everything.

## Troubleshooting

- **Something looks broken / the tray won't start**: run **`debug.bat`**
  instead - it runs the server directly in a visible window so you can
  see the actual error, completely bypassing the tray.
- **Playlist adding isn't working**: run
  `node test-playlist.js "https://www.youtube.com/playlist?list=..."`
  from a command prompt in this folder - it shows exactly what's
  happening without needing the website at all. If that shows videos
  found but the page still fails, YouTube may have changed something
  again; `node inspect-playlist.js "<same url>"` gives a deeper look at
  the current page structure for diagnosing that.
- **Port already in use**: every launch path (tray, install/start/debug,
  after Update) automatically clears the configured port and any
  duplicate tray instance first, so this shouldn't happen - if it does,
  `taskkill /F /IM node.exe` in a Command Prompt will force-stop it.

## Notes on how playlist reading works

Reading a YouTube playlist tries three independent methods, in order,
logging exactly what happened with each to `logs.txt`:

1. [`@distube/ytpl`](https://github.com/distubejs/ytpl), a maintained
   scraper library
2. A direct fetch of the playlist page, parsed by hand - understands
   both YouTube's older format and its newer "ViewModel" format, and
   follows pagination to get past the first ~100 videos on large
   playlists
3. YouTube's official RSS feed - can't break from page layout changes,
   but capped at the ~15 most recent videos, so it's a last-resort
   partial result only

Personal playlists (Watch Later, Liked Videos, auto-generated Mixes)
can't be read anonymously - use a public/unlisted playlist link instead.

## Notes on the YouTube Downloader

Unlike Lesson Tracker's playlist reading (see above), the downloader
doesn't scrape YouTube pages by hand at all - it drives the
[`yt-dlp`](https://github.com/yt-dlp/yt-dlp) binary directly as a child
process (no npm wrapper library), the same tool a huge portion of the
self-hosting/archiving community relies on specifically because it's
actively maintained against YouTube's frequent changes.

- **`yt-dlp` sets itself up automatically.** If it's not found (checked
  on your system PATH first, then in this app's own `tools-youtube/`
  folder), DEX Labs downloads it itself - no manual install step, no
  admin prompt. This also runs once in the background right at server
  startup so it's usually already done by the time you open the page.
- **`ffmpeg` ships inside the release zip** (in `tools-youtube/`), ready
  to use - the Downloader merges video/audio with it, and CCTV restreams
  the DVR's camera feeds through it. If your copy ever lacks it, place
  `ffmpeg.exe` (and `ffprobe.exe`/`ffplay.exe` if you want them) in
  `tools-youtube/` yourself (download:
  https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip, the
  binaries are in its `bin/` folder) - the app detects them the moment
  they're placed there, no restart needed. It's kept out of the Git
  repository (GitHub's 100MB-per-file limit), which is why the zip must
  include it separately.
- **`yt-dlp` keeps itself up to date.** Beyond the one-time install, DEX
  Labs periodically runs `yt-dlp`'s own self-update check in the
  background for as long as the server stays running - YouTube changes
  often enough that yt-dlp ships this mechanism for exactly this reason.
- Real quality options, not guesses: format info (resolutions, codecs,
  exact file sizes) is pulled from the video itself before you pick
  anything, and higher resolutions that YouTube only serves as separate
  video/audio streams are merged with `ffmpeg` automatically.
- Downloaded files land in `downloads-youtube/` and are swept away after
  24 hours if nobody's grabbed them (independent of AirDrop's 1-hour
  LAN-share rule - this is a personal download, not a shared drop). A
  download in progress also counts toward the same "don't restart me
  right now" busy state (`GET /api/busy`) that a running upload or timer
  already does, so the watchdog/auto-updater won't interrupt one.
- If `ffmpeg` auto-download is ever re-enabled: it's built in for Windows
  and macOS only. On Linux, install `ffmpeg` yourself via your package
  manager first (this project's actual target platform is Windows, per
  the Requirements section above).

## Project structure

```
server.js                  entrypoint - mounts routes, starts listening
db.js                      tiny JSON-file database for Lesson Tracker
routes/                    one file per subsystem's API endpoints, plus
                            settings.js (AirDrop setup, update banner,
                            subsystem show/hide)
lib/                       one store/logic file per subsystem, plus
                            youtube.js (playlist/video reading),
                            config-store.js (shared settings), and
                            subsystems-registry.js (the show/hide-menu
                            source of truth - see "Adding a new
                            subsystem" below)
public/                    the whole frontend - plain HTML/CSS/JS,
                            no build step, no framework
data/                      all persistent data (JSON files) - never
                            touched by the update process
uploads/                   Lesson Tracker's tute files
uploads-airdrop/           AirDrop's shared files (auto-deleted after
                            1hr; save location is user-configurable)
downloads-youtube/         YouTube Downloader's finished downloads
                            (auto-swept after 24hr if unclaimed)
tools-youtube/             the yt-dlp/ffmpeg binaries used by the
                            YouTube Downloader and CCTV (yt-dlp
                            auto-updates itself; ffmpeg ships in the
                            release zip)
tray.ps1                   the system tray application
apply-update.ps1           shared update logic (backup → extract →
                            npm install → refresh icon/shortcuts)
generate-icon.ps1          draws the tray icon once, caches it
create-shortcuts.ps1       creates the Desktop/Start Menu shortcuts
install.bat / start.bat /  setup and lifecycle scripts
  stop.bat / uninstall.bat /
  debug.bat / update.bat /
  clear-port.bat / run-hidden.vbs
test-playlist.js           standalone playlist-read diagnostic
inspect-playlist.js        standalone YouTube-page-structure diagnostic
backups/                   automatic pre-update backups (created on
                            first update)
```

## Adding a new subsystem

Follow the existing pattern (e.g. Daily Schedule is the simplest
example): a `lib/<name>-store.js` for its own tiny JSON-file database, a
`routes/<name>.js` for its API, and a `public/js/<name>.js` +
`public/css/<name>.css` for its frontend (a self-contained module
exposing `render()`, same shape as `airdrop.js`/`schedule.js`/
`timers.js`/`ytdownload.js`/`cctv.js`). Keep it independent - no
importing another subsystem's store or reaching into its data.

To actually plug it into the nav/show-hide-menu system:

1. Mount its router in `server.js`, wrapped in its own `try/catch` (same
   isolation pattern as every other subsystem) so a problem loading it
   can't take down anything else.
2. Add one entry to the `SUBSYSTEMS` array in
   `lib/subsystems-registry.js` (`id`, `label`, `navLabel`, `hash`,
   `hideable`) - this is the single source of truth the nav, the
   Settings page's show/hide list, and the tray's Settings dialog all
   read from.
3. In the module's own IIFE, self-register it:
   `window.DexSubsystems['<id>'] = { render };` alongside whatever else
   it already exports.
4. Add its `<script>`/`<link>` tags to `public/index.html`.

That's it - `public/js/app.js`'s router already has a generic
`window.DexSubsystems[id].render()` fallback for anything not
special-cased, so a new subsystem added this way needs **no changes to
`app.js` itself**, and shows up in the nav, the direct-hash routing, and
the show/hide Settings menu automatically. This is deliberately built to
scale past the handful of subsystems that exist today.

## License

No license has been chosen yet (`package.json` currently marks this
`UNLICENSED` as a safe default, meaning "all rights reserved"). If you'd
like to allow others to use or contribute to this, add a `LICENSE` file
(MIT is a common permissive choice for small personal projects) and
update `package.json`'s `license` field to match.
