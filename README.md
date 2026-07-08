# DEX Labs

A private personal website that runs on your own Windows PC and is
reachable from any phone or PC on your home WiFi. No cloud, no accounts,
no internet exposure - everything stays on your own network.

DEX Labs itself is just a shell; the actual features are independent
**subsystems** plugged into it, switchable from the top nav bar:

- **📚 Lesson Tracker** — organize YouTube lesson videos and playlists by
  subject and category, track which ones you've watched, view full
  titles/descriptions, and upload/download files ("tutes") per subject.
- **⇄ AirDrop** — drop a file in from any device on the WiFi, grab it
  from any other device, auto-deletes after 1 hour. 30GB shared storage
  at any given time.
- **📅 Daily Schedule** — a simple 3-day study planner grid.
- **⏱ Timers & Alarms** — up to 10 countdowns/alarms at once, shown as
  circular timers. When one goes off, the PC running DEX Labs beeps
  loudly through its own speakers - it's a real alarm, not just a
  silent website notification.

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
| **Update** | Pick a newer DEX Labs `.zip` release to install - backs up your data automatically first, and refuses anything that isn't actually newer |
| **Settings** | Currently: change the port DEX Labs runs on (more settings planned) |
| **Exit** | Fully stops DEX Labs |

## Updating

Two equivalent ways - your data is always backed up first, and an
update is rejected if it isn't actually newer than what you have:

- **Tray icon → Update** → pick the new `.zip`
- **Command line**: run `update.bat` (double-click it, or
  `update.bat "C:\path\to\update.zip"`)

Backups land in `backups\backup-<date>\`, kept until you delete them
yourself.

## Uninstalling

Run **`uninstall.bat`**. This removes auto-start, the shortcuts, and the
firewall rule. **Your data is never deleted** - it's still sitting in
the `data` and `uploads` folders; delete the whole application folder
yourself if you want to remove everything.

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

## Project structure

```
server.js                  entrypoint - mounts routes, starts listening
db.js                      tiny JSON-file database for Lesson Tracker
routes/                    one file per subsystem's API endpoints
lib/                       one store/logic file per subsystem, plus
                            youtube.js (playlist/video reading) and
                            config-store.js (shared settings)
public/                    the whole frontend - plain HTML/CSS/JS,
                            no build step, no framework
data/                      all persistent data (JSON files) - never
                            touched by the update process
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
`routes/<name>.js` for its API, a `public/js/<name>.js` +
`public/css/<name>.css` for its frontend (a self-contained module
exposing `window.<Name>.render()`), mounted in `server.js` (wrapped in
its own try/catch so a problem loading it can't take down anything
else), and a nav button + router branch added in `public/js/app.js` /
`public/index.html`. Keep it independent - no importing another
subsystem's store or reaching into its data.

## License

No license has been chosen yet (`package.json` currently marks this
`UNLICENSED` as a safe default, meaning "all rights reserved"). If you'd
like to allow others to use or contribute to this, add a `LICENSE` file
(MIT is a common permissive choice for small personal projects) and
update `package.json`'s `license` field to match.
