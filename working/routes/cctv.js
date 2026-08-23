// CCTV routes - v1.6.0. Mounted at /api/cctv in server.js (own mount,
// own try/catch, same as every other subsystem).
//
// Endpoints:
//   GET    /api/cctv/status                       - connection + camera list
//   POST   /api/cctv/discover                     - scan the LAN for the DVR
//   POST   /api/cctv/creds                        - verify + save host/creds
//   POST   /api/cctv/refresh                      - re-pull the channel list
//   GET    /api/cctv/snapshot/:channel?mode=main|sub
//                                                - single JPEG frame
//   GET    /api/cctv/stream/:channel?mode=main|sub&w=<px>&fps=<n>
//                                                - live MJPEG (ffmpeg pump)
//
// The DVR's own HTTP streaming endpoints (httpPreview / hls) are disabled
// on most current Hikvision units (403 / invalidOperation on the one this
// was built against), so live feed is pulled over RTSP and restreamed to
// MJPEG with the bundled ffmpeg (same tools-youtube/ folder the YouTube
// Downloader uses). MJPEG is deliberately chosen because any browser can
// render it in a plain <img> tag - no video plugin, no JS video library -
// which keeps every device type working: phones (portrait & landscape),
// tablets, and desktop.
const express = require('express');
const { spawn } = require('child_process');
const store = require('../lib/cctv-store');

const router = express.Router();

function handleError(res, err, fallbackStatus = 400) {
  res.status(fallbackStatus).json({ error: (err && err.message) || 'Something went wrong' });
}

// ---------------- status ----------------

router.get('/status', (req, res) => {
  res.json(store.publicStatus());
});

// ---------------- discover ----------------

router.post('/discover', async (req, res) => {
  try {
    const result = await store.discover(req.body || {});
    res.json(result.ok
      ? { ok: true, host: result.host, info: result.info, channels: result.channels, status: store.publicStatus() }
      : result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Discovery failed.' });
  }
});

// ---------------- creds (verify + save) ----------------

router.post('/creds', async (req, res) => {
  try {
    const { host, port, rtspPort, username, password } = req.body || {};
    const result = await store.testAndSaveConnection({ host, port, rtspPort, username, password });
    res.json(result.ok ? { ok: true, status: store.publicStatus(), channels: result.channels } : result);
  } catch (e) {
    handleError(res, e, 400);
  }
});

// ---------------- refresh channel list ----------------

router.post('/refresh', async (req, res) => {
  try {
    const cfg = store.get();
    if (!cfg.configured || !cfg.host) return res.status(400).json({ error: 'No DVR configured yet - discover or save credentials first.' });
    const auth = await store.deviceInfo(cfg.host, cfg.port, cfg.username, cfg.password);
    if (!auth) throw new Error('Could not reach the DVR - check it is powered on and connected.');
    const channels = await store.fetchAndEnrich(cfg.host, cfg.port, cfg.username, cfg.password);
    store.set({ channels, lastError: '', lastSeenAt: Date.now() });
    res.json({ ok: true, status: store.publicStatus(), channels });
  } catch (e) {
    store.set({ lastError: e.message, lastSeenAt: null });
    res.status(400).json({ error: e.message });
  }
});

// ---------------- channel validation helper ----------------

function resolveChannel(channelId) {
  const id = Number(channelId);
  if (!Number.isFinite(id)) return null;
  const cfg = store.get();
  const ch = (cfg.channels || []).find((c) => c.id === id);
  return { cfg, ch, id };
}

// ---------------- reorder channels ----------------

router.post('/reorder', async (req, res) => {
  try {
    const { channelOrder } = req.body || {};
    if (!channelOrder || !Array.isArray(channelOrder)) {
      return res.status(400).json({ error: 'channelOrder array is required.' });
    }
    const cfg = store.get();
    const oldChannels = cfg.channels || [];
    const idMap = new Map(oldChannels.map((c) => [c.id, c]));
    const newChannels = [];
    for (const id of channelOrder) {
      const ch = idMap.get(Number(id));
      if (ch) newChannels.push(ch);
    }
    // Add any channels not in the order at the end
    for (const c of oldChannels) {
      if (!newChannels.some((n) => n.id === c.id)) {
        newChannels.push(c);
      }
    }
    store.set({ channels: newChannels });
    res.json({ ok: true, channels: newChannels, status: store.publicStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to reorder channels.' });
  }
});

// ---------------- snapshot ----------------

router.get('/snapshot/:channel', async (req, res) => {
  const { cfg, ch, id } = resolveChannel(req.params.channel) || {};
  if (!cfg || !cfg.configured || !cfg.host) return res.status(400).json({ error: 'No DVR configured yet.' });
  if (!ch || !ch.enabled) return res.status(404).json({ error: `Channel ${req.params.channel} is not available.` });

  const mode = req.query.mode === 'sub' ? 'sub' : 'main';
  const url = store.rtspUrl(id, mode);
  const proc = spawn(store.ffmpegPath(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-rtsp_transport', 'tcp',
    '-fflags', 'nobuffer', '-flags', 'low_delay',
    '-i', url,
    '-an', '-sn', '-dn',
    '-frames:v', '1',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
  ], { windowsHide: true });

  const chunks = [];
  let done = false;
  const finish = (status, err) => {
    if (done) return;
    done = true;
    proc.kill();
    if (status === 200 && chunks.length > 0) {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, max-age=0',
      });
      res.end(Buffer.concat(chunks));
    } else {
      res.status(err ? 408 : 502).json({ error: err ? 'Snapshot timed out.' : 'Could not grab a frame from the camera.' });
    }
  };

  proc.stdout.on('data', (c) => {
    if (chunks.length > 0 || c.length > 0) chunks.push(c);
    if (done) return;
    // Stop once we have at least one complete JPEG (rough check: a JPEG
    // is a ffd8...ffd9 blob, so wait for an EOI marker in the buffer).
    const all = Buffer.concat(chunks);
    if (all.includes(Buffer.from([0xff, 0xd9])) && all.length > 2000) finish(200);
  });
  proc.stderr.on('data', () => { /* ffmpeg errors are expected on disconnect */ });
  proc.on('error', (e) => finish(500, e));
  proc.on('close', () => finish(500));
  setTimeout(() => finish(408), 12000).unref();
});

// ---------------- live MJPEG stream ----------------

const FRAME_BOUNDARY = '--frame';
const MAX_STREAMS = 24;
let activeStreams = 0;

function killTree(proc) {
  try { proc.stdin.end(); } catch (e) { /* ignore */ }
  try { proc.kill(); } catch (e) { /* already dead */ }
}

function streamMjpeg(req, res) {
  if (activeStreams >= MAX_STREAMS) {
    return res.status(503).json({ error: 'Too many live views open right now - close a few and try again.' });
  }

  const { cfg, ch, id } = resolveChannel(req.params.channel) || {};
  if (!cfg || !cfg.configured || !cfg.host) return res.status(400).json({ error: 'No DVR configured yet.' });
  if (!ch || !ch.enabled) return res.status(404).json({ error: `Channel ${req.params.channel} is not available.` });

  const mode = req.query.mode === 'sub' ? 'sub' : 'main';
  const wantW = Number(req.query.w) || (mode === 'sub' ? 480 : 1280);
  const wantFps = Math.min(Math.max(Number(req.query.fps) || (mode === 'sub' ? 8 : 12), 1), 25);
  let scaleFilter = `scale=${wantW}:-2`;
  // A fixed fps keeps bandwidth/CPU sane on the grid (8 always-on tiles)
  // while fullscreen stays smooth.
  let vf = `${scaleFilter},fps=${wantFps}`;
  if (mode === 'main') vf = `scale=1280:-2,fps=${wantFps}`;

  const url = store.rtspUrl(id, mode);
  const proc = spawn(store.ffmpegPath(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-rtsp_transport', 'tcp',
    '-fflags', 'nobuffer', '-flags', 'low_delay',
    '-i', url,
    '-an', '-sn', '-dn',
    '-vf', vf,
    '-q:v', '6',
    '-f', 'mjpeg',
    'pipe:1',
  ], { windowsHide: true });

  activeStreams++;
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-store, max-age=0',
    'Connection': 'close',
  });

  let buffer = Buffer.alloc(0);
  let ended = false;
  let lastDataAt = Date.now();

  const endIt = () => {
    if (ended) return;
    ended = true;
    killTree(proc);
    try { res.end(); } catch (e) { /* ignore */ }
    activeStreams = Math.max(0, activeStreams - 1);
  };

  // Split ffmpeg's raw concatenated-JPEG pipe output into individual
  // JPEGs (ffd8...ffd9) and wrap each in a multipart boundary so browsers
  // render the stream in a plain <img> tag without any plugins.
  proc.stdout.on('data', (chunk) => {
    lastDataAt = Date.now();
    if (ended) return;
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

    let consumed = 0;
    while (consumed < buffer.length) {
      // Find the start of the next JPEG.
      let start = -1;
      for (let i = consumed; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xff && buffer[i + 1] === 0xd8) { start = i; break; }
      }
      if (start === -1) {
        // Junk only - drop it.
        consumed = buffer.length;
        break;
      }
      // Find the EOI marker (ffd9). Byte-stuffing guarantees ffd9 never
      // appears inside entropy-coded data, so the first one is the end.
      let end = -1;
      for (let i = start + 2; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) { end = i + 1; break; }
      }
      if (end === -1) {
        consumed = start; // wait for more data - keep everything from the SOI
        break;
      }
      const frame = buffer.subarray(start, end + 1);
      const head = Buffer.from(
        `${FRAME_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`, 'utf-8'
      );
      const tail = Buffer.from('\r\n', 'utf-8');
      try {
        res.write(head);
        res.write(frame);
        res.write(tail);
      } catch (e) { endIt(); return; }
      consumed = end + 1;
      if (consumed >= buffer.length) { buffer = Buffer.alloc(0); break; }
    }
    if (consumed > 0 && consumed <= buffer.length) {
      buffer = buffer.subarray(consumed);
      if (buffer.length > 4 * 1024 * 1024) buffer = Buffer.alloc(0);
    }
  });

  proc.stderr.on('data', () => { /* expected when a client goes away */ });
  proc.on('error', () => endIt());
  proc.on('close', () => endIt());

  req.on('close', endIt);
  req.on('aborted', endIt);

  // If ffmpeg stalls (DVR hiccup) but the socket is still open, end the
  // response so the browser's <img> shows its onerror placeholder rather
  // than a frozen frame - the frontend reconnects on its own.
  const stallTimer = setInterval(() => {
    if (ended) { clearInterval(stallTimer); return; }
    if (Date.now() - lastDataAt > 15000) endIt();
  }, 5000);
  stallTimer.unref();
}

router.get('/stream/:channel', streamMjpeg);

module.exports = router;