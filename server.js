// Log anything that would otherwise crash the process silently in the
// background (run-hidden.vbs redirects console output to logs.txt) -
// without this, a startup failure just looks like "nothing works" with
// zero clue why.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err && err.stack || err);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled promise rejection:', err && err.stack || err);
});

const express = require('express');
const path = require('path');
const os = require('os');

const airdropStore = require('./lib/airdrop-store');
const timersStore = require('./lib/timers-store');
const ytdownloadStore = require('./lib/ytdownload-store');
const config = require('./lib/config-store');
const VERSION = require('./package.json').version;

// Port comes from data/config.json by default (settable via the tray
// app's Settings menu, and it survives updates since data/ is never
// touched by the update process). An explicit PORT env var always wins,
// for manual/advanced use (e.g. `set PORT=4000 && node server.js`).
const PORT = process.env.PORT || config.get().port || 3002;
const UPLOAD_ROOT = path.join(__dirname, 'uploads');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
// NOTE: this used to cache static files (index.html, app.js, css) in the
// browser for 1 hour (`maxAge: '1h'`). On an app that's actively being
// changed, that meant reloading the page could silently keep serving an
// OLD cached copy of the site for up to an hour with no visible sign
// anything was wrong - any fix made here wouldn't show up in the browser
// until the cache expired or someone did a hard refresh. Disabled.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true, lastModified: true }));

// Tracks in-flight file uploads (AirDrop drops, Lesson Tracker tute
// uploads) so the tray app's background auto-update can check GET
// /api/busy before installing an update mid-transfer. Deliberately a
// path-pattern match rather than anything per-subsystem, so it keeps
// working automatically if a future subsystem adds its own upload route -
// no per-feature wiring needed, same "independent subsystems" spirit as
// the rest of this project.
let activeUploads = 0;
app.use((req, res, next) => {
  const isUploadRequest = req.method === 'POST' && (/\/upload(\/|$)/i.test(req.path) || /\/tutes(\/|$)/i.test(req.path));
  if (isUploadRequest) {
    activeUploads++;
    let decremented = false;
    const decrement = () => {
      if (!decremented) {
        decremented = true;
        activeUploads = Math.max(0, activeUploads - 1);
      }
    };
    res.on('finish', decrement);
    res.on('close', decrement);
  }
  next();
});

// Two independent feature areas, mounted side by side. They don't share
// any data - Lesson Tracker uses data/db.json + /uploads, AirDrop uses
// data/airdrop.json + /uploads-airdrop. Each is wrapped in its own
// try/catch at require+mount time so a problem loading ONE feature
// (e.g. a dependency that failed to install) can never take the other
// feature - or static file serving, or the whole server - down with it.
try {
  const lessonsRouter = require('./routes/lessons');
  app.use('/api', lessonsRouter(UPLOAD_ROOT));
  console.log('[OK] Lesson Tracker routes loaded.');
} catch (err) {
  console.error('[ERROR] Lesson Tracker routes failed to load - that feature will be unavailable:', err && err.stack || err);
  app.use('/api/subjects', (req, res) => res.status(500).json({ error: 'Lesson Tracker failed to start. Check logs.txt.' }));
}

try {
  const airdropRouter = require('./routes/airdrop');
  app.use('/api/airdrop', airdropRouter);
  console.log('[OK] AirDrop routes loaded.');
} catch (err) {
  console.error('[ERROR] AirDrop routes failed to load - that feature will be unavailable:', err && err.stack || err);
  app.use('/api/airdrop', (req, res) => res.status(500).json({ error: 'AirDrop failed to start. Check logs.txt.' }));
}

try {
  const scheduleRouter = require('./routes/schedule');
  app.use('/api/schedule', scheduleRouter);
  console.log('[OK] Daily Schedule routes loaded.');
} catch (err) {
  console.error('[ERROR] Daily Schedule routes failed to load - that feature will be unavailable:', err && err.stack || err);
  app.use('/api/schedule', (req, res) => res.status(500).json({ error: 'Daily Schedule failed to start. Check logs.txt.' }));
}

try {
  // Clock subsystem - Timer, Alarm, and (v1.1.1) Stopwatch menus, all
  // mounted from this one router file (routes/timers.js). Route/id
  // stays '/api/timers' on purpose - never renamed once shipped.
  const timersRouter = require('./routes/timers');
  app.use('/api/timers', timersRouter);
  console.log('[OK] Clock routes loaded (Timer/Alarm/Stopwatch).');
} catch (err) {
  console.error('[ERROR] Clock routes failed to load - that feature will be unavailable:', err && err.stack || err);
  app.use('/api/timers', (req, res) => res.status(500).json({ error: 'Clock failed to start. Check logs.txt.' }));
}

try {
  const settingsRouter = require('./routes/settings');
  app.use('/api/settings', settingsRouter);
  console.log('[OK] Settings/update-notice routes loaded.');
} catch (err) {
  console.error('[ERROR] Settings routes failed to load - that feature will be unavailable:', err && err.stack || err);
  app.use('/api/settings', (req, res) => res.status(500).json({ error: 'Settings failed to start. Check logs.txt.' }));
}

try {
  // Study subsystem - subjects, active session (Stopwatch/Pomodoro,
  // server-authoritative timestamp math, same pattern as Clock's
  // Stopwatch - no tick loop needed, see lib/study-store.js), Pomodoro
  // settings (saved forever), manual day-logs, and stats/heatmap.
  const studyRouter = require('./routes/study');
  app.use('/api/study', studyRouter);
  console.log('[OK] Study routes loaded.');
} catch (err) {
  console.error('[ERROR] Study routes failed to load - that feature will be unavailable:', err && err.stack || err);
  app.use('/api/study', (req, res) => res.status(500).json({ error: 'Study failed to start. Check logs.txt.' }));
}

try {
  const ytdownloadRouter = require('./routes/ytdownload');
  app.use('/api/ytdownload', ytdownloadRouter);
  console.log('[OK] YouTube Downloader routes loaded.');
} catch (err) {
  console.error('[ERROR] YouTube Downloader routes failed to load - that feature will be unavailable:', err && err.stack || err);
  app.use('/api/ytdownload', (req, res) => res.status(500).json({ error: 'YouTube Downloader failed to start. Check logs.txt.' }));
}

// ---------- misc ----------
app.get('/api/server-info', (req, res) => {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  res.json({ port: PORT, addresses, version: VERSION });
});

app.get('/health', (req, res) => res.send('ok'));

// Used by the tray app's background auto-update timer to decide whether
// it's safe to install an update right now - "only auto update when no
// timer or any subsystem is running." Signals: uploads currently
// mid-transfer (tracked above), timers currently running/ringing
// (timersStore already tracks this via countActive() for its own
// 10-active cap enforcement, reused here rather than duplicated), and
// (v1.1.0 merge) YouTube downloads currently in flight - these are
// server-driven child-process work, not a browser upload, so they don't
// match the /upload(/|$) path pattern above and need their own signal
// the same way timers do.
app.get('/api/busy', async (req, res) => {
  let timersActive = 0;
  try {
    timersActive = await timersStore.countActive();
  } catch (e) {
    console.error('[busy-status] could not read timers state:', e && e.message);
  }
  let downloadsActive = 0;
  try {
    downloadsActive = await ytdownloadStore.countActive();
  } catch (e) {
    console.error('[busy-status] could not read YouTube Downloader state:', e && e.message);
  }
  const reasons = [];
  if (activeUploads > 0) reasons.push(`${activeUploads} file upload${activeUploads === 1 ? '' : 's'} in progress`);
  if (timersActive > 0) reasons.push(`${timersActive} timer${timersActive === 1 ? '' : 's'} running or ringing`);
  if (downloadsActive > 0) reasons.push(`${downloadsActive} YouTube download${downloadsActive === 1 ? '' : 's'} in progress`);
  res.json({ busy: reasons.length > 0, activeUploads, timersActive, downloadsActive, reasons });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`DEX Labs v${VERSION} running: http://localhost:${PORT}`);
  console.log(`  Subsystems: Lesson Tracker, AirDrop, Daily Schedule, Clock, YouTube Downloader, Study`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  On your WiFi/LAN:  http://${net.address}:${PORT}`);
      }
    }
  }
});

server.on('error', (err) => {
  console.error('[FATAL] Server failed to start:', err && err.stack || err);
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use - is the server already running? Try stop.bat first.`);
  }
});

// Don't let Node's default timeouts cut off very large (multi-GB) uploads
// on a slow LAN/WiFi connection.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

// AirDrop files self-destruct after 1 hour. Sweep for expired ones once a
// minute, and once right at startup in case the server was off when some
// expired.
airdropStore.cleanupExpired().catch((e) => console.error('AirDrop startup cleanup error:', e));
setInterval(() => {
  airdropStore.cleanupExpired().catch((e) => console.error('AirDrop cleanup error:', e));
}, 60 * 1000).unref();

// Timers/alarms are server-authoritative - check every second for any
// that just expired (triggers the loud server-side beep) or are still
// ringing (keeps re-beeping until dismissed).
setInterval(() => {
  timersStore.tick().catch((e) => console.error('Timers tick error:', e));
}, 1000).unref();

// YouTube Downloader: make sure yt-dlp/ffmpeg are set up in the
// background right away (so the first real visit to the page isn't the
// one waiting on a multi-minute ffmpeg download), keep checking yt-dlp
// for updates periodically (YouTube breaks it often - see
// PROJECT_BRIEFING), and sweep old finished downloads nobody grabbed.
ytdownloadStore.ensureTools().catch((e) => console.error('[ytdownload] initial tool setup failed (will retry when the page is used):', e.message));
setInterval(() => {
  ytdownloadStore.maybeSelfUpdateYtdlp().catch((e) => console.error('[ytdownload] self-update check error:', e));
}, 30 * 60 * 1000).unref();
setInterval(() => {
  ytdownloadStore.cleanupOldFiles().catch((e) => console.error('[ytdownload] cleanup error:', e));
}, 60 * 60 * 1000).unref();
