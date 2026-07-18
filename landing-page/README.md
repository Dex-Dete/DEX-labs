# DEX Labs - Landing Page

A page that lives at just your computer's IP address with **no port
needed** - the address you get when you type an IP into a browser with
nothing after it (browsers assume port 80). It lists whatever websites
are running on this computer (DEX Labs itself, plus anything else you
add), each with its own port, so anyone on the WiFi can find and open
them without already knowing the port.

## v1.1.4: no separate install step anymore

As of v1.1.4, this is fully integrated into DEX Labs' normal
install/update/tray lifecycle - **there is nothing separate to run.**

- If you're installing DEX Labs fresh, running `install.bat` (the usual
  one, in the main project folder - not anything inside this folder)
  sets this up too, automatically.
- If you already have DEX Labs installed and update to v1.1.4 or later
  (via the tray's Update menu, or by re-running `install.bat`), this
  turns on by itself - nothing to do.
- It starts and stops alongside DEX Labs' main server, automatically,
  every time - handled by `tray.ps1` (see `Start-DexLandingPage`/
  `Stop-DexLandingPage` if you're curious how). If it ever crashes, the
  same watchdog that watches the main server brings this back up too.
- **The one thing DEX Labs will ask you for**: the first time this ever
  runs on a given PC, Windows will show a permission prompt (User
  Account Control) so it can open the firewall for port 80 - this is
  needed so other devices on your WiFi can actually reach the page, not
  just this PC itself. Click "Yes". This only ever happens once - after
  that, DEX Labs never needs to ask again on that machine.
- Don't want it? Right-click the DEX Labs tray icon and untick
  **"Landing Page (site list on port 80)"** - it stops immediately, and
  won't start again until you tick it back on (from the tray, any time).

Prior to v1.1.4 (v1.1.3 only), this was a separate program with its own
`install-landing.bat`/`start-landing.bat`/etc. Those files no longer
exist - if you're upgrading from v1.1.3, the update process
automatically removes the old separate auto-start entry those left
behind, and your saved site list carries over untouched.

## Adding/editing/removing sites

Everything is done right on the page itself - no file editing needed:

- **Add a website**: fill in the small form at the bottom (name + port
  are required; path and note are optional) and click Add.
- **Edit**: click "Edit" on any card - the form fills in with that
  site's details; change what you like and click "Save changes" (or
  "Cancel edit" to back out).
- **Remove**: click "Remove" on a card. This only removes it from this
  list - it does NOT stop or delete the actual website/program.

DEX Labs itself is pre-added for you on first run (port 3002 by
default, or whatever port you've actually set it to via the tray's
Settings menu, if that's readable at the time this page first starts).

Each card shows a small green/gray dot for whether that port is
actually answering right now, checked every few seconds - handy for
things you don't leave running all the time (e.g. a media server you
only start occasionally).

## If port 80 is already taken by something else

Run `netstat -ano | findstr :80` in Command Prompt to see the PID (last
number in each line) using it, then check Task Manager's **Details**
tab for what that PID actually is. Common causes on Windows:

- **IIS / "World Wide Web Publishing Service"** - many Windows editions
  include this, and it can be running even if you never turned it on
  deliberately. Open `services.msc`, find "World Wide Web Publishing
  Service", stop it, and set it to Disabled if you don't need IIS for
  anything else.
- **PID 4 ("System")** - this means Windows' own `http.sys` driver has
  the port reserved for something (usually IIS, above). You can't and
  shouldn't try to kill PID 4 - it's not a real closable process, it's
  the kernel. Free the port by stopping whatever Windows *service* has
  reserved it (see above), not by killing a PID. (`tray.ps1` already
  knows to leave PID 4 alone rather than trying to kill it.)
- Some VPN clients, Docker Desktop, older Skype versions, or an
  antivirus's web-filtering component.

If you genuinely can't free port 80: untick "Landing Page" from the
tray menu to stop it fighting for a port it can't have, or create
`landing-page\data\landing-config.json` containing e.g. `{ "port": 8080
}` to run it on a different port instead. **Note this means people DO
have to type a port again** (`http://<your ip>:8080`), which defeats the
actual point of this feature - only do this if freeing port 80 truly
isn't an option.

## Files in this folder

```
server.js                  the standalone server itself (port 80 by
                            default), zero npm dependencies (built-in
                            http/fs/path/net/url only) - started/
                            stopped by tray.ps1, not by anything in
                            this folder
lib/sites-store.js          the saved site list's own tiny JSON-file
                            "database" - data/sites.json
public/                     the page itself (plain HTML/CSS/JS, no
                            build step, same philosophy as the rest of
                            this project)
data/sites.json               your saved site list (auto-created,
                            preserved automatically across updates -
                            see PROJECT_BRIEFING.md's v1.1.4 section if
                            you're curious how)
data/landing-config.json        optional override - only needed if you
                            deliberately moved this off port 80 (see
                            above); doesn't exist by default
```

(v1.1.3's `install-landing.bat`, `start-landing.bat`, `stop-landing.bat`,
`uninstall-landing.bat`, `clear-landing-port.bat`, and
`run-landing-hidden.vbs` no longer exist - see `tray.ps1` for the
equivalent logic now.)

## Known limitations

- Not tested on real Windows/real hardware in the session that built
  it (same caveat as `tray.ps1` elsewhere in this project - no Windows
  available in that sandbox). Written carefully against patterns
  already proven to work elsewhere in this project (the firewall-rule
  and Startup-shortcut steps in `install.bat`, the PID-kill pattern in
  `clear-port.bat`, the standard `Start-Process -Verb RunAs`
  self-elevation idiom), but that's not the same as having run it for
  real. If something doesn't work as described, get the exact error
  text from `logs.txt` (via the tray's Console menu item) rather than
  guessing.
- The "online/offline" check is a plain TCP connect, not an HTTP
  request - it can only tell you *something* is listening on that
  port, not that it's actually a working website (e.g. a half-crashed
  server that accepts connections but never responds would still show
  as "online").
- No password/login on this page - anyone on your WiFi can see the
  list and use the Add/Edit/Remove form. Fine for a home network; don't
  expose port 80 to the wider internet (e.g. via router port
  forwarding) without adding some form of access control first.
