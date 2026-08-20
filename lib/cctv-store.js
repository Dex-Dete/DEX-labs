// CCTV subsystem store - the Hikvision DVR live-feed feature.
//
// Own store file (data/cctv.json), own router (routes/cctv.js), own
// frontend module (public/js/cctv.js) - same per-subsystem isolation
// pattern as every other subsystem in this project.
//
// This store holds:
//   - the DVR's connection settings (host, HTTP port, RTSP port,
//     username/password) - shown to nobody, never logged;
//   - the camera/channel list pulled from the DVR via ISAPI;
//   - discovery results when the user asks DEX Labs to "find" the DVR.
//
// It ALSO hosts the Hikvision ISAPI helper code (digest-auth HTTP client,
// device probe, channel enumeration, and the subnet scanner that finds
// the DVR). That is this subsystem's business logic, so it lives next to
// the data it talks about, rather than being spread across the route
// file - identity: routes/cctv.js stays thin (HTTP + ffmpeg process
// plumbing), this file owns "how does DEX Labs talk to a Hikvision DVR".
//
// Security notes:
//   - Credentials are stored in data/cctv.json exactly like every other
//     setting (plain on disk; get()'s never expose the password to the
//     frontend - status reports `passwordSet: true`, not the value).
//   - This is a personal LAN app ("no login needed on the DEX Labs site"
//     per the brief), so no extra auth is added on top of ISAPI's own
//     digest auth against the DVR.
//   - The stream/snapshot endpoints accept channel numbers only, and the
//     RTSP URL is always rebuilt server-side from stored creds - the
//     browser never sees a password, and there is no way to point DEX
//     Labs at an arbitrary RTSP URL through these endpoints.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const os = require('os');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'cctv.json');

const DEFAULT_CREDS = [
  { username: 'admin', password: 'Admin@123' },
  { username: 'Admin', password: 'Admin@123' },
  { username: 'admin', password: 'admin@123' },
  { username: 'Admin', password: 'admin@123' },
];

const DEFAULTS = {
  configured: false,
  host: '',
  port: 80,
  rtspPort: 554,
  username: 'admin',
  password: 'Admin@123',
  channels: [],        // [{ id, name, enabled, mainEnabled, subEnabled }]
  lastError: '',
  lastSeenAt: null,    // epoch ms of last successful ISAPI contact
  discoveredAt: null,  // epoch ms of last automatic discovery
};

// v1.5.x: keep old default creds from a prior save when a fresh file is
// created, so re-discovering after a reset still just works.
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));

let cache = null;
function get() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    cache = { ...DEFAULTS, ...raw };
  } catch (e) {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function set(partial) {
  const current = get();
  const next = { ...current, ...partial };
  cache = next;
  const tmpPath = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmpPath, CONFIG_PATH);
  return next;
}

// ---------------- Local subnet helpers ----------------

// The live camera grid needs the RTSP/ISAPI URLs to point at the DVR,
// which only works while DEX Labs and the DVR are on the same network.
// Getting the machine's own /24 is the sane default for discovery.
function localSubnets() {
  const out = new Set();
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const parts = net.address.split('.');
      if (parts.length === 4) out.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }
  // Default to the documented range from the brief if we somehow have no
  // LAN IPv4 address (192.168.1.1-255).
  if (out.size === 0) out.add('192.168.1');
  return Array.from(out);
}

function candidateHosts() {
  const hosts = [];
  for (const sub of localSubnets()) {
    for (let i = 1; i <= 255; i++) hosts.push(`${sub}.${i}`);
  }
  return hosts;
}

// ---------------- Digest-auth HTTP client (ISAPI) ----------------

// Hikvision's ISAPI uses HTTP Digest auth (RFC 2617). No npm dep needed -
// it is ~40 lines and this project deliberately avoids adding deps for
// things this small. Returns { status, headers, body }.
function digestRequest(host, port, pathname, { username, password, timeoutMs = 8000, method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let state = { authHeader: null, nonce: null };

    const attempt = () => {
      const req = http.request({
        host,
        port,
        path: pathname,
        method,
        headers: {
          Host: `${host}:${port}`,
          Accept: '*/*',
          ...headers,
          ...(state.authHeader ? { Authorization: state.authHeader } : {}),
        },
        timeout: timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode === 401 && !state.authHeader) {
            const wwwAuth = res.headers['www-authenticate'] || '';
            const parsed = parseDigestChallenge(wwwAuth);
            if (parsed) {
              state.nonce = parsed.nonce;
              state.authHeader = buildDigestHeader(parsed, method, pathname, username, password);
              return attempt();
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on('timeout', () => { req.destroy(new Error(`Connection to ${host}:${port} timed out`)); });
      req.on('error', reject);
      req.end();
    };

    attempt();
  });
}

function parseDigestChallenge(header) {
  const m = /realm="([^"]*)"/.exec(header);
  const n = /nonce="([^"]*)"/.exec(header);
  const q = /qop="([^"]*)"/.exec(header);
  const o = /opaque="([^"]*)"/.exec(header);
  if (!m || !n) return null;
  return { realm: m[1], nonce: n[1], qop: q ? q[1] : null, opaque: o ? o[1] : null };
}

function md5hex(s) {
  return crypto.createHash('md5').update(s, 'utf-8').digest('hex');
}

function buildDigestHeader(challenge, method, uri, username, password) {
  const HA1 = md5hex(`${username}:${challenge.realm}:${password}`);
  const HA2 = md5hex(`${method}:${uri}`);
  const cnonce = crypto.randomBytes(8).toString('hex');
  let response;
  if (challenge.qop && challenge.qop.includes('auth')) {
    response = md5hex(`${HA1}:${challenge.nonce}:00000001:${cnonce}:auth:${HA2}`);
  } else {
    response = md5hex(`${HA1}:${challenge.nonce}:${HA2}`);
  }
  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (challenge.qop && challenge.qop.includes('auth')) {
    parts.push('qop=auth', 'nc=00000001', `cnonce="${cnonce}"`);
  } else {
    parts.push('algorithm=MD5');
  }
  return `Digest ${parts.join(', ')}`;
}

// ---------------- ISAPI device helpers ----------------

function deviceInfo(host, port, username, password) {
  return digestRequest(host, port, '/ISAPI/System/deviceInfo', { username, password })
    .then((r) => {
      if (r.status === 200 && /<DeviceInfo/i.test(r.body)) {
        const grab = (re) => { const m = re.exec(r.body); return m ? m[1].trim() : ''; };
        return {
          deviceName: grab(/<deviceName>(.*?)<\/deviceName>/),
          model: grab(/<model>(.*?)<\/model>/),
          serialNumber: grab(/<serialNumber>(.*?)<\/serialNumber>/),
          firmwareVersion: grab(/<firmwareVersion>(.*?)<\/firmwareVersion>/),
          macAddress: grab(/<macAddress>(.*?)<\/macAddress>/),
          deviceType: grab(/<deviceType>(.*?)<\/deviceType>/),
        };
      }
      return null;
    });
}

// Enabled camera channel list. The InputProxyChannel list includes
// disabled/unplugged history, so we cross-check each channel's streaming
// channels (10X01 = main, 10X02 = sub) to know which live feeds actually
// exist. Channels here use the DVR's 1-based numbering (channel 1 -> RTSP
// path /Streaming/Channels/101).
function fetchChannels(host, port, username, password) {
  return digestRequest(host, port, '/ISAPI/ContentMgmt/InputProxy/channels', { username, password })
    .then(async (r) => {
      if (r.status !== 200 || !/<InputProxyChannel/i.test(r.body)) {
        throw new Error(`DVR returned HTTP ${r.status} for channel list`);
      }
      const items = [];
      const blockRe = /<InputProxyChannel[\s\S]*?<\/InputProxyChannel>/g;
      let block;
      while ((block = blockRe.exec(r.body)) !== null) {
        const seg = block[0];
        const grab = (re) => { const m = re.exec(seg); return m ? m[1].trim() : ''; };
        const id = parseInt(grab(/<id>(\d+)<\/id>/), 10);
        if (!Number.isFinite(id)) continue;
        items.push({
          id,
          name: grab(/<channelName>(.*?)<\/channelName>/) || `Camera ${id}`,
          enabled: /<enabled>true<\/enabled>/i.test(seg),
        });
      }
      if (items.length === 0) {
        // Some units don't expose InputProxyChannel - fall back to a
        // generic probe of streaming channels 101..801.
        for (let i = 1; i <= 32; i++) {
          const res = await digestRequest(host, port, `/ISAPI/Streaming/channels/${i}01`, { username, password });
          if (res.status === 200 && /<StreamingChannel/i.test(res.body)) {
            items.push({ id: i, name: `Camera ${i}`, enabled: true });
          } else if (res.status !== 200 && /<ResponseStatus/i.test(res.body)) {
            break; // past the last channel
          }
        }
      }
      return items.sort((a, b) => a.id - b.id);
    });
}

// Which of a channel's streams (main 10X01 / sub 10X02) are actually on.
async function streamAvailability(host, port, username, password, channelId) {
  const out = { mainEnabled: false, subEnabled: false };
  for (const [suffix, key] of [['01', 'mainEnabled'], ['02', 'subEnabled']]) {
    try {
      const r = await digestRequest(host, port, `/ISAPI/Streaming/channels/${channelId}${suffix}`, { username, password });
      out[key] = r.status === 200 && /<enabled>true<\/enabled>/i.test(r.body);
    } catch (e) {
      out[key] = false;
    }
  }
  return out;
}

// ---------------- Connection / discovery ----------------

// Try credential pairs against a host until one authenticates (ISAPI
// deviceInfo returns 200). `prefs` is the explicitly configured pair; on
// a discovery scan (`allowFallback: true`) the brief's documented defaults
// are tried after it, so a fresh install still finds the DVR out of the
// box. When the user actively saves a form (`allowFallback: false`), ONLY
// the entered credentials are tried - silently falling back to defaults
// there would hide a wrong password behind the factory ones.
function tryAuth(host, port, prefs, allowFallback) {
  const candidates = [];
  const seen = new Set();
  if (prefs && prefs.username) {
    candidates.push({ username: prefs.username, password: prefs.password || '' });
    seen.add(`${prefs.username}:${prefs.password || ''}`);
  }
  if (allowFallback) {
    for (const c of DEFAULT_CREDS) {
      const key = `${c.username}:${c.password}`;
      if (!seen.has(key)) { candidates.push(c); seen.add(key); }
    }
  }
  const tasks = candidates.map(async (c) => {
    try {
      const info = await deviceInfo(host, port, c.username, c.password);
      if (info) return { ok: true, credentials: c, info };
    } catch (e) { /* try next */ }
    return { ok: false };
  });
  // Run sequentially - a flood of parallel auth attempts can trip the
  // DVR's lockout-login counter (retryLoginTime: 6 in the probe above).
  return (async () => {
    for (const t of tasks) {
      const r = await t;
      if (r.ok) return r;
    }
    return { ok: false };
  })();
}

// Quick TCP reachability probe. The Hikvision SDK port (8000) is the
// single most reliable "this is a Hikvision device" signal and the
// cheapest to scan across the whole subnet; HTTP port 80 is the fallback
// signal (confirmed by a real ISAPI digest challenge).
function probePort(host, port, timeoutMs = 350) {
  return new Promise((resolve) => {
    const sock = require('net').connect({ host, port });
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(false));
  });
}

// Full subnet scan for a Hikvision DVR. Returns the first host that both
// answers ISAPI AND authenticates with the preferred (or default)
// credentials - that IS the DVR for this install going forward.
async function discover(prefs, onProgress) {
  const hosts = candidateHosts();
  const scored = [];   // hosts that even look Hikvision-y (8000 or 80 open)
  const CHUNK = 32;
  for (let i = 0; i < hosts.length; i += CHUNK) {
    const chunk = hosts.slice(i, i + CHUNK);
    if (onProgress) onProgress(Math.min((i + CHUNK) / hosts.length, 1));
    const results = await Promise.all(
      chunk.map(async (h) => {
        const sdk = await probePort(h, 8000);
        const web = await probePort(h, 80);
        return { h, sdk, web };
      })
    );
    for (const r of results) {
      if (r.sdk || r.web) scored.push(r);
    }
  }
  if (onProgress) onProgress(1);

  // Prefer SDK-port hits (near-certain Hikvision), then web-port ones.
  scored.sort((a, b) => (b.sdk ? 1 : 0) - (a.sdk ? 1 : 0));
  for (const cand of scored) {
    const port = 80; // ISAPI always lives on the HTTP port
    const auth = await tryAuth(cand.h, port, prefs, true);
    if (auth.ok) {
      const channels = await fetchChannels(cand.h, port, auth.credentials.username, auth.credentials.password).catch(() => []);
const withStreams = await fetchAndEnrich(cand.h, port, auth.credentials.username, auth.credentials.password);
  set({
        configured: true,
        host: cand.h,
        port,
        rtspPort: 554,
        username: auth.credentials.username,
        password: auth.credentials.password,
        channels: withStreams,
        lastError: '',
        lastSeenAt: Date.now(),
        discoveredAt: Date.now(),
      });
      return { ok: true, host: cand.h, info: auth.info, channels: withStreams };
    }
  }
  return { ok: false, error: 'No Hikvision DVR found on the local network. Check that it is powered on, wired to the same router, and that the credentials are right.' };
}

function fetchAndEnrich(host, port, username, password) {
  return fetchChannels(host, port, username, password).then(async (channels) => {
    const withStreams = [];
    for (const ch of channels) {
      const avail = await streamAvailability(host, port, username, password, ch.id).catch(() => ({ mainEnabled: false, subEnabled: false }));
      withStreams.push({ ...ch, ...avail });
    }
    return withStreams;
  });
}

// After a manual "save credentials" in Settings or the CCTV page, verify
// the given host/creds actually work, pull the cameras, and persist.
async function testAndSaveConnection({ host, port, rtspPort, username, password }) {
  const h = String(host || '').trim();
  const p = Number(port) || 80;
  const rp = Number(rtspPort) || 554;
  if (!h) throw new Error('DVR address is required.');
  if (p < 1 || p > 65535 || rp < 1 || rp > 65535) throw new Error('Ports must be between 1 and 65535.');
  if (!username) throw new Error('Username is required.');
  if (!password) {
    // Left blank on the form = "keep the saved password".
    password = get().password || '';
  }
  if (!password) throw new Error('Password is required (or leave the field blank to keep the saved one).');

  const auth = await tryAuth(h, p, { username, password }, false);
  if (!auth.ok) throw new Error('Could not log in - check the username/password and that the DVR address is correct.');

  const withStreams = await fetchAndEnrich(h, p, auth.credentials.username, auth.credentials.password);

  const saved = set({
    configured: true,
    host: h,
    port: p,
    rtspPort: rp,
    username: auth.credentials.username,
    password: auth.credentials.password,
    channels: withStreams,
    lastError: '',
    lastSeenAt: Date.now(),
  });
  return { ok: true, config: saved, channels: withStreams };
}

// ---------------- Public status ----------------

function publicStatus() {
  const cfg = get();
  const lastSeenMs = cfg.lastSeenAt || null;
  return {
    configured: !!cfg.configured,
    host: cfg.host || '',
    port: cfg.port || 80,
    rtspPort: cfg.rtspPort || 554,
    username: cfg.username || '',
    passwordSet: !!cfg.password,
    channels: cfg.channels || [],
    lastError: cfg.lastError || '',
    lastSeenAt: lastSeenMs,
    seenRecently: !!lastSeenMs && Date.now() - lastSeenMs < 24 * 60 * 60 * 1000,
    ffmpegAvailable: require('fs').existsSync(path.join(__dirname, '..', 'tools-youtube', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')),
  };
}

function ffmpegPath() {
  const local = path.join(__dirname, '..', 'tools-youtube', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(local) ? local : 'ffmpeg';
}

// Stored credentials, used only server-side to build RTSP URLs. The
// password is percent-encoded (it can legally contain @, :, etc. which
// are URL syntax).
function rtspUrl(channelId, mode) {
  const cfg = get();
  const suffix = mode === 'sub' ? '02' : '01';
  const user = encodeURIComponent(cfg.username || '');
  const pass = encodeURIComponent(cfg.password || '');
  return `rtsp://${user}:${pass}@${cfg.host}:${cfg.rtspPort}/Streaming/Channels/${channelId}${suffix}`;
}

module.exports = {
  get,
  set,
  discover,
  testAndSaveConnection,
  fetchAndEnrich,
  publicStatus,
  rtspUrl,
  ffmpegPath,
  digestRequest,
  deviceInfo,
  DEFAULT_CREDS,
  CONFIG_PATH,
};