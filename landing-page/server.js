// DEX Labs "Landing Page" - v1.1.3 (standalone), integrated into the
// main app's lifecycle as of v1.1.4
//
// WHAT THIS IS AND WHY IT'S A SEPARATE PROCESS/PORT (BUT NOT A SEPARATE
// PROGRAM ANYMORE)
// -----------------------------------------------------
// A tiny, standalone, zero-dependency web page that sits on port 80 (the
// browser's default HTTP port - the one you get when you type just an
// IP address with no ":port" at all) and lists whatever other websites
// are running on this same computer, each with its own port, so someone
// on the WiFi can find and open them without needing to already know
// DEX Labs' own port (3002) or anyone else's.
//
// v1.1.3 shipped this as a fully separate program (own install/start/
// stop `.bat` files, own manual setup step). v1.1.4 folds it into DEX
// Labs' normal lifecycle - tray.ps1's Start-DexLandingPage/
// Stop-DexLandingPage now start and stop this alongside the main Node
// server automatically, and request the one Windows permission it needs
// (opening the firewall for port 80) itself, the first time it's ever
// needed on a given machine. No more separate install step - if DEX
// Labs is installed/running, this is too (unless deliberately turned
// off from the tray menu).
//
// It's still its OWN Node process and OWN port, though, on purpose -
// this file itself, this port, this file's own data
// (landing-page/data/sites.json) haven't changed. Two reasons that
// separation still matters even though it's now managed by the same
// tray app:
//   1. This page needs to keep working even if DEX Labs' own server
//      (port 3002) is stopped, mid-update, or has crashed - it's the
//      front door people hit first, often specifically BECAUSE
//      something else on 3002 isn't answering.
//   2. Port 80 and port 3002 are unrelated concerns with unrelated
//      failure modes (see the port-80-in-use guidance in the error
//      handler below) - mixing them into one process means a problem
//      with one can take down the other for no good reason.
//
// No npm dependencies at all (plain 'http'/'fs'/'path'/'net'/'url' -
// all built into Node) - same "don't add anything that can fail to
// install" philosophy as the rest of this project (see
// PROJECT_BRIEFING.md's "why no native npm tray package").
//
// See landing-page/README.md for the port-80-is-taken troubleshooting
// steps and everything about how the site list works, and
// PROJECT_BRIEFING.md's v1.1.4 section for exactly how tray.ps1 manages
// this process's lifecycle now.
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { URL } = require('url');
const sitesStore = require('./lib/sites-store');

const PUBLIC_DIR = path.join(__dirname, 'public');
const OWN_CONFIG_PATH = path.join(__dirname, 'data', 'landing-config.json');

// The port THIS page itself listens on - always 80 unless overridden.
// Checked in order:
//   1. landing-page/data/landing-config.json's "port" - the v1.1.3
//      standalone override file. Kept working for anyone who already
//      set one back when this was a separate program with its own
//      install-landing.bat, so upgrading to the integrated v1.1.4
//      doesn't silently drop a deliberate customization.
//   2. The main app's own shared data/config.json's "landingPagePort" -
//      the v1.1.4 way to override it (set via a future tray/Settings
//      option, or by hand), now that this runs as an integrated part
//      of the same app rather than a fully separate program.
//   3. 80 - the default, and the entire point of this feature: typing
//      an IP with nothing after it assumes port 80.
// Note that overriding this away from 80 means people DO need to type a
// port again ("http://<ip>:8080"), which defeats the actual point of
// this feature - it's an escape hatch for "port 80 is unrecoverably
// taken by something else", not the intended setup.
function readOwnPort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(OWN_CONFIG_PATH, 'utf-8'));
    if (cfg && Number.isInteger(cfg.port) && cfg.port >= 1 && cfg.port <= 65535) return cfg.port;
  } catch (e) { /* no v1.1.3-style override file - normal for a fresh v1.1.4 install */ }
  try {
    const mainConfigPath = path.join(__dirname, '..', 'data', 'config.json');
    const mainCfg = JSON.parse(fs.readFileSync(mainConfigPath, 'utf-8'));
    if (mainCfg && Number.isInteger(mainCfg.landingPagePort) && mainCfg.landingPagePort >= 1 && mainCfg.landingPagePort <= 65535) {
      return mainCfg.landingPagePort;
    }
  } catch (e) { /* main config not there/readable/no override set - 80 default is fine */ }
  return 80;
}
const PORT = readOwnPort();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

// Is anything actually listening on this port on THIS machine right
// now? A plain TCP connect-and-see, not an HTTP request - works for
// literally any kind of server (web, Plex, a game server, whatever),
// which matters since we only know a port number, not what protocol
// the thing on it speaks. Short timeout since this runs once per site
// per page load/poll and there could be several sites in the list.
function checkPortOpen(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (isOpen) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (e) { /* already closing */ }
      resolve(isOpen);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) { reject(new Error('Request body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // ---- API ----
    if (pathname === '/api/sites' && req.method === 'GET') {
      const sites = await sitesStore.listAll();
      // Check every site's port in parallel - one slow/unreachable
      // site shouldn't make the whole list wait for it sequentially.
      const withStatus = await Promise.all(
        sites.map(async (s) => ({ ...s, online: await checkPortOpen(s.port) }))
      );
      return sendJson(res, 200, withStatus);
    }

    if (pathname === '/api/sites' && req.method === 'POST') {
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
      try {
        const site = await sitesStore.create(body);
        return sendJson(res, 201, site);
      } catch (e) { return sendJson(res, 400, { error: e.message }); }
    }

    const siteIdMatch = pathname.match(/^\/api\/sites\/([^/]+)$/);
    if (siteIdMatch && req.method === 'PUT') {
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
      try {
        const site = await sitesStore.edit(siteIdMatch[1], body);
        if (!site) return sendJson(res, 404, { error: 'Site not found' });
        return sendJson(res, 200, site);
      } catch (e) { return sendJson(res, 400, { error: e.message }); }
    }

    if (siteIdMatch && req.method === 'DELETE') {
      await sitesStore.remove(siteIdMatch[1]);
      return sendJson(res, 200, { ok: true });
    }

    // ---- Static files (public/ only, GET only) ----
    if (req.method === 'GET') {
      const requestedName = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      // Deliberately narrow allow-list pattern (no dots-as-path-traversal,
      // no subfolders) - this tiny server only ever needs to serve the
      // handful of known files in public/, not act as a general file
      // server, so there's no path-traversal surface to worry about.
      if (/^[a-zA-Z0-9_-]+\.(html|css|js)$/.test(requestedName)) {
        const filePath = path.join(PUBLIC_DIR, requestedName);
        if (fs.existsSync(filePath)) return serveStaticFile(res, filePath);
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    console.error('[landing-page] request handling error:', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`
[FATAL] Port ${PORT} is already in use - the Landing Page can't start.
This is almost always ONE of these:
  - Another copy of this same Landing Page is already running (check
    the system tray / Task Manager for a stray node.exe, or just
    restart your PC).
  - Windows' own IIS / "World Wide Web Publishing Service" - common on
    Windows editions that include IIS, even if you never turned it on
    deliberately. Check: open Services (services.msc), look for "World
    Wide Web Publishing Service", stop AND disable it if you don't need
    IIS for anything else.
  - Another app that happens to use port 80 (some VPN clients, Docker
    Desktop, Skype in old versions, IIS Express, some antivirus web
    filters).
Run "netstat -ano | findstr :${PORT}" in Command Prompt to see the PID
using the port, then Task Manager -> Details tab -> find that PID -> see
what it is. See landing-page/README.md for the full walkthrough,
including the PID-4-is-not-a-real-process case.
`);
  } else {
    console.error('[FATAL] Landing Page failed to start:', err && err.stack || err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DEX Labs Landing Page running: http://localhost${PORT === 80 ? '' : ':' + PORT}/`);
  console.log('On your WiFi/LAN, anyone can open this page at your IP with NO port needed (if PORT is 80).');
});
