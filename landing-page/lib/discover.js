// Landing Page's LAN auto-discovery. Finds other web pages reachable
// from THIS machine on the same local subnet (router admin, CCTV/NVR
// web UIs, other DEX Labs installs, game consoles, etc) so they show up
// on this page automatically - no need to already know their IP, unlike
// the manually-added list in sites-store.js/data/sites.json.
//
// Kept zero-dependency and in landing-page's own lib/, same as
// sites-store.js and the rest of this standalone process - see
// server.js's big top-of-file comment for why this whole feature lives
// in its own process/port rather than as a DEX Labs subsystem. (An
// earlier v1.1.8 draft of this DID ship as a DEX Labs subsystem page -
// that was the wrong place for it and got moved here instead, since the
// whole point of this page is being the one-stop "what's reachable on
// this network" front door.)
//
// Scope, by design: this only ever scans the local subnet(s) this
// machine is already a member of - never the wider internet - and only
// does a plain TCP connect plus a normal HTTP GET to read a page's
// <title>. No logins, no credential guessing, nothing exploit-shaped.
// Because it will surface ANY device that answers - including a
// neighbour's, on a shared building/apartment network - the frontend
// shows a short reminder about that; see public/index.html.
const os = require('os');
const net = require('net');
const http = require('http');
const https = require('https');

// Ports worth checking. Deliberately ONLY things that plausibly serve a
// web page - unlike DEX Labs' short-lived netscan subsystem draft, this
// does not include RTSP (554/8554) or raw printer ports (631/9100),
// since those aren't "websites" and this page is specifically about
// websites. A camera/NVR's own web UI (if it has one) still shows up
// fine on whichever HTTP port it uses.
const PORTS = [
  { port: 80, label: 'HTTP' },
  { port: 443, label: 'HTTPS', tls: true },
  { port: 8080, label: 'HTTP (8080)' },
  { port: 8081, label: 'HTTP (8081)' },
  { port: 8443, label: 'HTTPS (8443)', tls: true },
  { port: 8000, label: 'HTTP (8000)' },
  { port: 8888, label: 'HTTP (8888)' },
  { port: 9000, label: 'HTTP (9000)' },
  { port: 9090, label: 'HTTP (9090)' },
  { port: 81, label: 'HTTP (81)' },
  { port: 82, label: 'HTTP (82)' },
  { port: 88, label: 'HTTP (88)' },
  { port: 3000, label: 'HTTP (3000)' },
  { port: 5000, label: 'HTTP (5000)' },
  { port: 32400, label: 'Plex' },
];

const CONNECT_TIMEOUT_MS = 350;
const HTTP_TIMEOUT_MS = 1200;
const HOST_CONCURRENCY = 32;

function getLocalSubnets() {
  const nets = os.networkInterfaces();
  const subnets = [];
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const parts = iface.address.split('.');
      if (parts.length !== 4) continue;
      // Assume a /24 - true for the overwhelming majority of home
      // networks, including the 192.168.1.x case this was built for.
      subnets.push({ base: parts.slice(0, 3).join('.'), ownIp: iface.address });
    }
  }
  return subnets;
}

function pickSubnet(requestedBase) {
  const subnets = getLocalSubnets();
  if (requestedBase) {
    const match = subnets.find((s) => s.base === requestedBase);
    if (match) return match;
    return { base: requestedBase, ownIp: null };
  }
  return subnets.find((s) => s.base.startsWith('192.168')) || subnets[0] || null;
}

function tcpProbe(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

// Returns null if this didn't actually behave like a website (no HTTP
// response at all) - callers use that to filter down to "only working,
// running websites", not just "something is listening on this port".
function fetchTitleAndServer(ip, port, useTls) {
  return new Promise((resolve) => {
    const lib = useTls ? https : http;
    let done = false;
    const req = lib.get(
      {
        host: ip,
        port,
        path: '/',
        timeout: HTTP_TIMEOUT_MS,
        rejectUnauthorized: false, // self-signed certs are normal for LAN devices (routers, cameras)
        headers: { 'User-Agent': 'DEX-Labs-LandingPage-Discovery/1.0' },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          if (body.length < 4000) body += chunk.toString('utf8');
        });
        res.on('end', () => {
          if (done) return;
          done = true;
          const match = body.match(/<title[^>]*>([^<]*)<\/title>/i);
          resolve({
            title: match ? match[1].trim().slice(0, 120) : null,
            server: res.headers['server'] || null,
            status: res.statusCode,
          });
        });
      }
    );
    req.on('timeout', () => { if (!done) { done = true; req.destroy(); resolve(null); } });
    req.on('error', () => { if (!done) { done = true; resolve(null); } });
  });
}

async function scanOneHost(ip, ownIp) {
  const checks = PORTS.map(async (def) => {
    const open = await tcpProbe(ip, def.port, CONNECT_TIMEOUT_MS);
    if (!open) return null;
    const info = await fetchTitleAndServer(ip, def.port, !!def.tls);
    // Only count it as a "website" if it actually answered HTTP -
    // an open port with no HTTP response behind it is filtered out here.
    if (!info) return null;
    const scheme = def.tls ? 'https' : 'http';
    return {
      id: `${ip}:${def.port}`,
      ip,
      port: def.port,
      url: `${scheme}://${ip}:${def.port}/`,
      faviconUrl: `${scheme}://${ip}:${def.port}/favicon.ico`,
      title: info.title || `${ip}:${def.port}`,
      server: info.server || null,
      isSelf: ip === ownIp,
    };
  });
  const settled = await Promise.all(checks);
  return settled.filter(Boolean);
}

async function scanNetwork(requestedBase) {
  const chosen = pickSubnet(requestedBase);
  if (!chosen) {
    return { subnet: null, ownIp: null, sites: [], error: 'No active network connection was found on this machine.' };
  }
  const { base, ownIp } = chosen;
  const ips = [];
  for (let i = 1; i <= 254; i++) ips.push(`${base}.${i}`);

  const found = [];
  let cursor = 0;
  async function worker() {
    while (cursor < ips.length) {
      const ip = ips[cursor++];
      const sites = await scanOneHost(ip, ownIp);
      found.push(...sites);
    }
  }
  await Promise.all(Array.from({ length: HOST_CONCURRENCY }, worker));

  found.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }) || a.port - b.port);
  return { subnet: base, ownIp, sites: found, error: null };
}

module.exports = { scanNetwork, getLocalSubnets };
