// YouTube Downloader subsystem - fully self-contained, same isolation
// pattern as lib/airdrop-store.js / lib/schedule-store.js / lib/timers-store.js.
// Deliberately does NOT import or touch lib/youtube.js (that file is
// Lesson Tracker's video/playlist METADATA reader - oEmbed + the
// three-strategy playlist scraper) or db.js or any other subsystem's
// data. This is a different tool (actually downloading a video file to
// disk) that happens to also talk to YouTube, on the same site/port.
//
// Responsibilities of this one file (per the "own storage/lib file"
// convention - kept as a single file, like lib/youtube.js is):
//   1. Locating/installing/self-updating the yt-dlp and ffmpeg binaries
//      this feature needs (own tools-youtube/ folder, own logic - no npm
//      wrapper library for the actual downloading, see the README note
//      on @distube/ytpl for why this project avoids that pattern).
//   2. Looking up a video's real available formats (yt-dlp -J) and
//      turning them into a small set of concrete quality choices with
//      real estimated sizes.
//   3. Running the actual download (spawning yt-dlp directly as a child
//      process), tracking progress, and persisting job records to its
//      own data/ytdownload.json - own "database", same as every other
//      subsystem.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ytdownload.json');
const TOOLS_DIR = path.join(__dirname, '..', 'tools-youtube');
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads-youtube');

// Finished downloads aren't a LAN-share tool like AirDrop (no TTL
// requirement was asked for), but leaving arbitrarily large video files
// on disk forever isn't great either - sweep anything older than this
// that's still sitting around unclaimed. Deliberately much longer than
// AirDrop's 1hr, since these are a deliberate personal download, not a
// quick drop-and-grab between devices.
const FINISHED_FILE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// yt-dlp ships a self-update mechanism (`-U`) specifically because
// YouTube breaks extraction often. Don't just run it once at install
// time - re-check periodically for as long as the server stays up.
const SELF_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

// ffmpeg's automatic download (unlike yt-dlp's, which has been solid)
// turned out unreliable in practice - a real user hit gyan.dev
// rate-limiting the connection to a trickle, and even with the
// retry/fallback-host/throughput-watchdog work below, "some host on the
// internet serving a big zip reliably" is just a flakier thing to
// depend on than "an 11MB binary from GitHub." Turned OFF here at the
// user's explicit request in favor of a clear manual-placement message
// (with the direct link included) - see the ffmpeg branch of
// ensureTools() below. yt-dlp's auto-download is untouched, it's been
// reliable. Flip this back to `true` to re-enable ffmpeg auto-download
// if it's ever worth revisiting - all the download/fallback/retry logic
// is still here and still tested, just not called for ffmpeg.
const AUTO_DOWNLOAD_FFMPEG = false;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ jobs: [] }, null, 2));

// ---------------- tiny JSON-file "database", own file ----------------
let writeQueue = Promise.resolve();

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    return { jobs: [] };
  }
}

function write(data) {
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

function update(mutator) {
  writeQueue = writeQueue.then(() => {
    const data = read();
    const result = mutator(data);
    write(data);
    return result;
  });
  return writeQueue;
}

function genId() {
  return `ytjob_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// =======================================================================
// Binary management: locate, auto-install, and self-update yt-dlp/ffmpeg
// =======================================================================

function isWindows() { return process.platform === 'win32'; }

function ytdlpBinaryName() { return isWindows() ? 'yt-dlp.exe' : 'yt-dlp'; }
function ffmpegBinaryName() { return isWindows() ? 'ffmpeg.exe' : 'ffmpeg'; }
function ffprobeBinaryName() { return isWindows() ? 'ffprobe.exe' : 'ffprobe'; }

function localYtdlpPath() { return path.join(TOOLS_DIR, ytdlpBinaryName()); }
function localFfmpegPath() { return path.join(TOOLS_DIR, ffmpegBinaryName()); }
function localFfprobePath() { return path.join(TOOLS_DIR, ffprobeBinaryName()); }

// Runs `<cmd> <args>` synchronously just to check it exists/works - used
// both for our own downloaded copies and for anything already on the
// user's system PATH (no point re-downloading something that's already
// installed and working).
function commandWorks(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { windowsHide: true, timeout: 8000 });
    return result.status === 0 || result.status === null && !result.error;
  } catch (e) {
    return false;
  }
}

function versionOf(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { windowsHide: true, timeout: 8000, encoding: 'utf-8' });
    if (result.status === 0 && result.stdout) return result.stdout.trim().split('\n')[0];
  } catch (e) { /* not available */ }
  return null;
}

// Resolves which yt-dlp to actually invoke: our own managed copy first
// (tools-youtube/), then anything already on the system PATH. Returns
// null if neither works.
function resolveYtdlp() {
  const local = localYtdlpPath();
  if (fs.existsSync(local) && commandWorks(local, ['--version'])) return local;
  if (commandWorks('yt-dlp', ['--version'])) return 'yt-dlp';
  return null;
}

function resolveFfmpeg() {
  const local = localFfmpegPath();
  const localProbe = localFfprobePath();
  if (fs.existsSync(local) && commandWorks(local, ['-version'])) {
    return { ffmpeg: local, ffprobe: fs.existsSync(localProbe) ? localProbe : null };
  }
  if (commandWorks('ffmpeg', ['-version'])) {
    return { ffmpeg: 'ffmpeg', ffprobe: commandWorks('ffprobe', ['-version']) ? 'ffprobe' : null };
  }
  return null;
}

// Direct, stable release-asset URLs - no GitHub API calls needed (avoids
// API rate limits, same "direct asset link, not the API" preference used
// elsewhere in this project for release downloads).
function ytdlpDownloadUrl() {
  if (isWindows()) return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  if (process.platform === 'darwin') return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
}

// ffmpeg has no single stable raw-binary URL the way yt-dlp does, so
// these come as zips. Handled per-platform; Linux (not this project's
// actual target platform - see README's Windows-only requirement) just
// gets a clear message pointing at the system package manager rather
// than us guessing at a static-build URL/layout that's much less
// standardized than the Windows one.
//
// Returns a LIST, not a single URL - tried in order. A real user hit a
// plain network failure reaching gyan.dev (single point of failure), so
// this now falls back to a second, independent host (BtbN's GitHub
// releases, also a stable "latest" tag alias, same direct-asset-link
// approach as yt-dlp's own URL) before giving up. Both are zips with a
// version-numbered internal folder - extractBinariesFromZip() already
// hunts by basename regardless of that nested path, so no extra logic
// is needed to support a second source.
function ffmpegZipUrls() {
  if (isWindows()) {
    return [
      'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
      'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    ];
  }
  if (process.platform === 'darwin') return ['https://evermeet.cx/ffmpeg/getrelease/zip'];
  return [];
}

// Node's built-in fetch (undici) throws a bare "fetch failed" for any
// network-level problem (DNS failure, connection refused, TLS error,
// antivirus/firewall interception, etc.) - the actually useful reason
// lives in `error.cause`, which fetch does NOT include in the top-level
// message. Surfacing it here is the difference between a user seeing
// "fetch failed" (useless) and "getaddrinfo ENOTFOUND www.gyan.dev"
// (actionable - that's a DNS/connectivity problem, not a code bug).
function describeFetchError(e) {
  const cause = e && e.cause;
  const causeText = cause ? (cause.code ? `${cause.code}: ${cause.message || ''}`.trim() : cause.message) : null;
  if (e && e.name === 'AbortError') return 'the connection stalled (no data received) and was cancelled';
  if (causeText) return causeText;
  return (e && e.message) || 'unknown network error';
}

async function downloadToFile(url, destPath, onProgress) {
  // A hard cutoff on the WHOLE download would wrongly kill a large,
  // legitimately-slow-but-still-progressing download (ffmpeg's zip is
  // 80-140MB - easily >60s on an ordinary home connection). Instead,
  // this aborts only if no data arrives for STALL_MS at a stretch -
  // a real hang (server never responds, connection silently dies)
  // still gets caught, but a slow-and-steady download doesn't.
  const STALL_MS = 30000;
  // A SEPARATE problem from a full stall: some hosts (gyan.dev has been
  // observed doing this) rate-limit a connection to a trickle - a few
  // bytes every few seconds - which is just enough to keep resetting the
  // stall timer forever without the download ever meaningfully
  // progressing. A real report: stuck at 5% with a 100mbps connection,
  // .part file not visibly growing. The stall timer alone can't catch
  // this since data IS arriving, just uselessly slowly. This watchdog
  // checks average throughput after a grace period (to allow for normal
  // TLS handshake / slow-start) and gives up if it's below a floor that
  // even a bad connection should clear easily - so this attempt fails
  // fast and the caller's fallback-host/retry logic gets a real chance,
  // instead of the UI sitting frozen looking broken.
  const MIN_BYTES_PER_SEC = 15 * 1024; // 15 KB/s - deliberately generous; a real download is normally orders of magnitude faster
  const THROUGHPUT_GRACE_MS = 20000;

  const controller = new AbortController();
  let stallTimer = setTimeout(() => controller.abort(), STALL_MS);
  function resetStallTimer() {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), STALL_MS);
  }

  let res;
  const requestStartedAt = Date.now();
  try {
    res = await fetch(url, { redirect: 'follow', signal: controller.signal });
  } catch (e) {
    clearTimeout(stallTimer);
    throw new Error(describeFetchError(e));
  }
  resetStallTimer(); // headers arrived - reset the clock for the body
  if (!res.ok || !res.body) {
    clearTimeout(stallTimer);
    throw new Error(`server responded with HTTP ${res.status} - the download link may have changed`);
  }
  const totalBytes = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let tooSlow = false;
  const tmpPath = destPath + '.part';
  const fileStream = fs.createWriteStream(tmpPath);
  const reader = res.body.getReader();
  const throughputTimer = setInterval(() => {
    const elapsedSec = (Date.now() - requestStartedAt) / 1000;
    if (elapsedSec < THROUGHPUT_GRACE_MS / 1000) return;
    if (received / elapsedSec < MIN_BYTES_PER_SEC) {
      tooSlow = true;
      controller.abort();
    }
  }, 4000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetStallTimer();
      received += value.length;
      await new Promise((resolve, reject) => {
        fileStream.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
      if (totalBytes && onProgress) onProgress(received / totalBytes);
    }
  } catch (e) {
    if (tooSlow) throw new Error(`this download source is responding too slowly (under ${Math.round(MIN_BYTES_PER_SEC / 1024)}KB/s sustained) - it may be rate-limiting this connection`);
    throw new Error(describeFetchError(e));
  } finally {
    clearTimeout(stallTimer);
    clearInterval(throughputTimer);
    await new Promise((resolve) => fileStream.end(resolve));
  }
  fs.renameSync(tmpPath, destPath);
}

// One retry with a short delay - covers ordinary transient blips (a
// dropped WiFi packet, a momentary DNS hiccup) without masking a real,
// persistent problem (that still surfaces clearly after the retry fails
// too).
async function downloadToFileWithRetry(url, destPath, onProgress) {
  try {
    await downloadToFile(url, destPath, onProgress);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 2000));
    await downloadToFile(url, destPath, onProgress);
  }
}

// ---- tiny dependency-free ZIP reader (just enough to pull two files
// out of a build archive) ----------------------------------------------
// ffmpeg has no single stable raw-binary URL the way yt-dlp does, so its
// builds ship as a zip. Rather than pull in an npm zip library (another
// third-party dependency this project would rather avoid - see the
// @distube/ytpl saga in PROJECT_BRIEFING for why), this hand-rolls just
// enough of the ZIP format using Node's built-in `zlib` for the actual
// decompression (DEFLATE/STORED only - the only methods any common
// ffmpeg build zip uses). Supports plain ZIP only, not ZIP64 (irrelevant
// here since these builds are well under 4GB).
const zlib = require('zlib');

function readZipCentralDirectory(buffer) {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - 65557); // max comment length + EOCD size
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('not a valid zip file (no end-of-central-directory record found)');

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let offset = cdOffset;
  const CD_SIG = 0x02014b50;
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(offset) !== CD_SIG) throw new Error('corrupt zip central directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf-8', offset + 46, offset + 46 + fileNameLength);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('this zip uses ZIP64 (file too large for this simple reader)');
    }
    entries.push({ fileName, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function extractZipEntryData(buffer, entry) {
  const LOCAL_SIG = 0x04034b50;
  const lo = entry.localHeaderOffset;
  if (buffer.readUInt32LE(lo) !== LOCAL_SIG) throw new Error('corrupt zip local file header');
  const fileNameLength = buffer.readUInt16LE(lo + 26);
  const extraLength = buffer.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + fileNameLength + extraLength;
  const compressedData = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(compressedData); // stored, no compression
  if (entry.method === 8) return zlib.inflateRawSync(compressedData); // deflate
  throw new Error(`unsupported zip compression method (${entry.method})`);
}

// Extracts specific named files out of a zip archive by filename,
// regardless of which folder they're nested inside - ffmpeg build zips
// wrap their contents in a version-numbered folder name that changes
// every release (e.g. "ffmpeg-7.0.2-essentials_build\bin\ffmpeg.exe"),
// so hunting by basename is robust to the builder renaming that folder,
// which they do on every release.
function extractBinariesFromZip(zipPath, wantedNames, destDir) {
  const buffer = fs.readFileSync(zipPath);
  const entries = readZipCentralDirectory(buffer);
  const found = {};
  for (const entry of entries) {
    if (entry.fileName.endsWith('/')) continue; // directory entry
    const base = path.basename(entry.fileName.replace(/\\/g, '/'));
    if (wantedNames.includes(base) && !found[base]) {
      const data = extractZipEntryData(buffer, entry);
      const outPath = path.join(destDir, base);
      fs.writeFileSync(outPath, data);
      found[base] = outPath;
    }
  }
  return found;
}

let setupState = { status: 'idle', message: '', ytdlpPath: null, ffmpeg: null };
let setupPromise = null;

function getSetupState() {
  return { ...setupState };
}

// Makes sure yt-dlp and ffmpeg are ready to use, downloading/installing
// either one automatically if missing. Safe to call repeatedly - if a
// setup attempt is already in flight, callers share that same promise
// rather than kicking off a second concurrent download.
function ensureTools(force) {
  if (setupPromise && !force) return setupPromise;

  setupPromise = (async () => {
    try {
      setupState = { status: 'checking', message: 'Checking for yt-dlp and ffmpeg…', ytdlpPath: null, ffmpeg: null };

      let ytdlpPath = resolveYtdlp();
      if (!ytdlpPath) {
        setupState = { status: 'downloading-ytdlp', message: 'yt-dlp not found - downloading it now (one-time setup)…', ytdlpPath: null, ffmpeg: null };
        const dest = localYtdlpPath();
        try {
          await downloadToFileWithRetry(ytdlpDownloadUrl(), dest, (frac) => {
            setupState.message = `Downloading yt-dlp… ${Math.round(frac * 100)}%`;
          });
          if (!isWindows()) fs.chmodSync(dest, 0o755);
        } catch (e) {
          throw new Error(`Couldn't download yt-dlp automatically (${e.message}). Check your internet connection, or manually place a yt-dlp binary at ${dest} and try again.`);
        }
        ytdlpPath = resolveYtdlp();
        if (!ytdlpPath) {
          throw new Error(`Downloaded yt-dlp to ${dest}, but it didn't run correctly. It may be corrupted or blocked - try deleting that file and retrying.`);
        }
      }

      let ffmpeg = resolveFfmpeg();
      if (!ffmpeg) {
        if (!AUTO_DOWNLOAD_FFMPEG) {
          const manualUrls = ffmpegZipUrls();
          const linkText = manualUrls.length
            ? `Download it yourself: ${manualUrls[0]} - open the zip, pull "bin/${ffmpegBinaryName()}" and "bin/${ffprobeBinaryName()}" out, and place both directly in ${TOOLS_DIR}`
            : `Install ffmpeg yourself (e.g. your package manager) and make sure it is on your PATH`;
          throw new Error(`ffmpeg auto-download is turned off. ${linkText}, then try again - no restart needed, this page checks automatically.`);
        }
        setupState = { status: 'downloading-ffmpeg', message: 'ffmpeg not found - downloading it now (one-time setup, this one is a bigger file)…', ytdlpPath, ffmpeg: null };
        const candidateUrls = ffmpegZipUrls();
        if (candidateUrls.length === 0) {
          throw new Error('ffmpeg was not found on this system and this platform has no automatic ffmpeg setup built in (Windows/macOS are supported automatically). Please install ffmpeg yourself (e.g. your package manager) and make sure it is on your PATH, then try again.');
        }
        const zipPath = path.join(TOOLS_DIR, '_ffmpeg-download.zip');
        const attemptFailures = [];
        let downloaded = false;
        for (const zipUrl of candidateUrls) {
          const host = new URL(zipUrl).hostname;
          try {
            setupState.message = `Downloading ffmpeg from ${host}…`;
            await downloadToFileWithRetry(zipUrl, zipPath, (frac) => {
              setupState.message = `Downloading ffmpeg from ${host}… ${Math.round(frac * 100)}%`;
            });
            downloaded = true;
            break;
          } catch (e) {
            attemptFailures.push(`${host} (${e.message})`);
          }
        }
        if (!downloaded) {
          throw new Error(`Couldn't download ffmpeg automatically - tried ${attemptFailures.join(', then ')}. Check your internet connection (or whether antivirus/firewall is blocking this app), or manually place ffmpeg/ffprobe binaries in ${TOOLS_DIR} yourself.`);
        }
        try {
          setupState.message = 'Extracting ffmpeg…';
          const found = extractBinariesFromZip(zipPath, [ffmpegBinaryName(), ffprobeBinaryName()], TOOLS_DIR);
          if (!found[ffmpegBinaryName()]) {
            throw new Error('the downloaded archive did not contain an ffmpeg binary where expected');
          }
          if (!isWindows()) {
            if (found[ffmpegBinaryName()]) fs.chmodSync(found[ffmpegBinaryName()], 0o755);
            if (found[ffprobeBinaryName()]) fs.chmodSync(found[ffprobeBinaryName()], 0o755);
          }
        } catch (e) {
          throw new Error(`Downloaded ffmpeg but couldn't set it up (${e.message}). Try deleting ${TOOLS_DIR} and retrying.`);
        } finally {
          try { fs.unlinkSync(zipPath); } catch (e) { /* best effort cleanup */ }
        }
        ffmpeg = resolveFfmpeg();
        if (!ffmpeg) {
          throw new Error('ffmpeg was downloaded and extracted but still could not be run. It may be blocked by antivirus/SmartScreen - try allowing it and retrying.');
        }
      }

      setupState = { status: 'ready', message: 'Ready.', ytdlpPath, ffmpeg };
      return setupState;
    } catch (e) {
      setupState = { status: 'error', message: e.message, ytdlpPath: null, ffmpeg: null };
      throw e;
    } finally {
      setupPromise = null;
    }
  })();

  return setupPromise;
}

let lastSelfUpdateAt = 0;
// Called periodically by server.js (like airdrop's cleanup sweep and
// timers' tick loop) - re-checks yt-dlp for a newer release and updates
// itself in place. Best-effort: logs the outcome, never throws, since
// this runs unattended in the background.
async function maybeSelfUpdateYtdlp() {
  const now = Date.now();
  if (now - lastSelfUpdateAt < SELF_UPDATE_INTERVAL_MS) return;
  const ytdlpPath = resolveYtdlp();
  if (!ytdlpPath) return; // nothing to update yet - ensureTools() handles first install
  lastSelfUpdateAt = now;
  await new Promise((resolve) => {
    const p = spawn(ytdlpPath, ['-U'], { windowsHide: true });
    let out = '';
    p.stdout && p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr && p.stderr.on('data', (d) => { out += d.toString(); });
    p.on('error', (e) => { console.error('[ytdownload] self-update check failed to launch:', e.message); resolve(); });
    p.on('close', () => {
      const summary = out.trim().split('\n').pop() || '(no output)';
      console.log('[ytdownload] yt-dlp self-update check:', summary);
      resolve();
    });
  });
}

// =======================================================================
// Video lookup - real formats, real sizes, before any download starts
// =======================================================================

// Real YouTube video IDs are always exactly 11 characters (see
// PROJECT_BRIEFING's lesson #4 - bit the Lesson Tracker work once
// already; applying the same validation here).
const VIDEO_ID_RE = /^[\w-]{11}$/;

function extractVideoId(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl.trim());
  } catch (e) {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.split('/').filter(Boolean)[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.searchParams.get('v') && VIDEO_ID_RE.test(u.searchParams.get('v'))) {
      return u.searchParams.get('v');
    }
    const parts = u.pathname.split('/').filter(Boolean);
    const shortsOrEmbedIdx = parts.findIndex((p) => p === 'shorts' || p === 'embed' || p === 'live');
    if (shortsOrEmbedIdx !== -1 && parts[shortsOrEmbedIdx + 1] && VIDEO_ID_RE.test(parts[shortsOrEmbedIdx + 1])) {
      return parts[shortsOrEmbedIdx + 1];
    }
    return null;
  }
  return null;
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return 'unknown size';
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { bytes /= 1024; i++; } while (bytes >= 1024 && i < units.length - 1);
  return bytes.toFixed(bytes >= 10 ? 0 : 1) + ' ' + units[i];
}

function sizeOf(fmt) {
  if (!fmt) return null;
  return fmt.filesize || fmt.filesize_approx || null;
}

// Turns yt-dlp's raw format list into a short, distinct set of real
// choices - "Max", "Medium", "Lowest", plus an audio-only option if the
// video has separate audio streams (it always does, once formats are
// split into video-only/audio-only above roughly SD quality).
function buildQualityOptions(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];

  const videoFormats = formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.height);
  const audioFormats = formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));

  const bestAudio = audioFormats.slice().sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0] || null;

  // Dedup by height, keeping the highest-bitrate format at each height.
  const byHeight = new Map();
  for (const f of videoFormats) {
    const existing = byHeight.get(f.height);
    if (!existing || (f.tbr || 0) > (existing.tbr || 0)) byHeight.set(f.height, f);
  }
  const distinctByHeight = Array.from(byHeight.values()).sort((a, b) => b.height - a.height);

  function toOption(f, label) {
    const needsMerge = !f.acodec || f.acodec === 'none';
    const audioSize = needsMerge && bestAudio ? sizeOf(bestAudio) : 0;
    const videoSize = sizeOf(f);
    const totalSize = (videoSize === null && (!needsMerge || bestAudio === null)) ? null
      : (videoSize || 0) + (audioSize || 0);
    return {
      id: `${f.format_id}${needsMerge && bestAudio ? '+' + bestAudio.format_id : ''}`,
      label,
      resolution: `${f.height}p${f.fps && f.fps > 30 ? f.fps : ''}`,
      ext: needsMerge ? 'mp4' : f.ext, // merged output is normalized to mp4 below
      sizeBytes: totalSize,
      sizeLabel: fmtSize(totalSize),
      needsMerge,
      formatSelector: needsMerge && bestAudio ? `${f.format_id}+${bestAudio.format_id}` : f.format_id,
    };
  }

  const options = [];
  if (distinctByHeight.length > 0) {
    const max = distinctByHeight[0];
    const lowest = distinctByHeight[distinctByHeight.length - 1];
    const midIndex = Math.floor((distinctByHeight.length - 1) / 2);
    const medium = distinctByHeight[midIndex];

    options.push(toOption(max, 'Max quality'));
    if (medium !== max && medium !== lowest) options.push(toOption(medium, 'Medium quality'));
    if (lowest !== max) options.push(toOption(lowest, 'Lowest quality'));
  }

  if (bestAudio) {
    const size = sizeOf(bestAudio);
    options.push({
      id: `audio-${bestAudio.format_id}`,
      label: 'Audio only',
      resolution: `${Math.round(bestAudio.abr || bestAudio.tbr || 0)}kbps ${bestAudio.acodec || ''}`.trim(),
      ext: bestAudio.ext,
      sizeBytes: size,
      sizeLabel: fmtSize(size),
      needsMerge: false,
      formatSelector: bestAudio.format_id,
    });
  }

  return options;
}

function classifyYtdlpError(stderrText) {
  const text = (stderrText || '').toLowerCase();
  if (text.includes('private video')) return "This video is private and can't be downloaded.";
  if (text.includes('video unavailable') || text.includes('has been removed')) return "This video is unavailable - it may have been deleted or taken down.";
  if (text.includes('sign in to confirm your age') || text.includes('age-restricted') || text.includes('inappropriate for some users')) {
    return "This video is age-restricted - yt-dlp can't download it without a signed-in YouTube account, which this feature doesn't support.";
  }
  if (text.includes('sign in') && text.includes('bot')) return "YouTube is asking to verify this isn't a bot request. Try again in a bit, or try a different video.";
  if (text.includes('this live event') || (text.includes('premiere') && text.includes('will begin'))) {
    return "This is a live stream or premiere that hasn't started yet - there's nothing to download until it airs.";
  }
  if (text.includes('members-only') || text.includes('join this channel')) return "This is a members-only video and can't be downloaded without channel membership access.";
  if (text.includes('unable to download webpage') || text.includes('urlopen error') || text.includes('network is unreachable') || text.includes('name or service not known') || text.includes('timed out')) {
    return 'A network error interrupted this - check the internet connection and try again.';
  }
  if (text.includes('unsupported url')) return "That doesn't look like a YouTube video link yt-dlp recognizes.";
  const lines = (stderrText || '').trim().split('\n').filter(Boolean);
  const lastMeaningful = lines.reverse().find((l) => l.toLowerCase().includes('error')) || lines[0];
  return lastMeaningful ? `Download failed: ${lastMeaningful.replace(/^ERROR:\s*/i, '')}` : 'Download failed for an unknown reason.';
}

async function lookupVideo(rawUrl) {
  const videoId = extractVideoId(rawUrl);
  if (!videoId) {
    const err = new Error("That doesn't look like a valid YouTube video link. Paste a link like https://www.youtube.com/watch?v=... or https://youtu.be/...");
    err.statusCode = 400;
    throw err;
  }

  await ensureTools();
  const ytdlpPath = resolveYtdlp();
  if (!ytdlpPath) {
    const err = new Error('yt-dlp is not set up yet - try again in a moment.');
    err.statusCode = 503;
    throw err;
  }

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const info = await new Promise((resolve, reject) => {
    const args = ['-J', '--no-warnings', '--no-playlist', '--no-check-certificates', canonicalUrl];
    const p = spawn(ytdlpPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', (e) => reject(new Error(`Couldn't run yt-dlp (${e.message}).`)));
    p.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        return reject(new Error(classifyYtdlpError(stderr)));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error("yt-dlp returned data this feature couldn't understand - it may need updating."));
      }
    });
  });

  const options = buildQualityOptions(info);
  if (options.length === 0) {
    const err = new Error("Couldn't find any downloadable video/audio formats for this video.");
    err.statusCode = 502;
    throw err;
  }

  return {
    videoId,
    title: info.title || 'Untitled video',
    channel: info.uploader || info.channel || null,
    durationSec: info.duration || null,
    thumbnail: info.thumbnail || (Array.isArray(info.thumbnails) && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : null),
    options,
  };
}

// =======================================================================
// Job records (data/ytdownload.json) + running the actual download
// =======================================================================

const runningProcesses = new Map(); // jobId -> ChildProcess, in-memory only (never persisted - a process handle can't survive a restart anyway)

async function listJobs() {
  const data = read();
  return data.jobs.slice().sort((a, b) => b.createdAt - a.createdAt);
}

// v1.1.0 merge: mirrors lib/timers-store.js's countActive() - lets
// server.js's GET /api/busy (used by the tray's watchdog/auto-update to
// avoid restarting mid-transfer) know about downloads currently running,
// the same way it already knows about active timers.
async function countActive() {
  const data = read();
  return data.jobs.filter((j) => j.status === 'queued' || j.status === 'downloading').length;
}

async function getJob(id) {
  const data = read();
  return data.jobs.find((j) => j.id === id) || null;
}

function createJobRecord(entry) {
  return update((data) => {
    data.jobs.push(entry);
    return entry;
  });
}

function patchJob(id, patch) {
  return update((data) => {
    const job = data.jobs.find((j) => j.id === id);
    if (job) Object.assign(job, patch);
    return job || null;
  });
}

async function removeJob(id) {
  const job = await getJob(id);
  if (job && job.outputFile) {
    try { fs.unlinkSync(path.join(DOWNLOADS_DIR, job.outputFile)); } catch (e) { /* already gone */ }
  }
  killJob(id);
  await update((data) => { data.jobs = data.jobs.filter((j) => j.id !== id); });
  return !!job;
}

function killJob(id) {
  const proc = runningProcesses.get(id);
  if (proc) {
    try { proc.kill(); } catch (e) { /* already exited */ }
    runningProcesses.delete(id);
  }
}

// Parses yt-dlp's --newline progress output. Stable, well-documented
// format across recent yt-dlp versions:
//   [download]  45.2% of   12.34MiB at    1.23MiB/s ETA 00:07
//   [download] 100% of 12.34MiB in 00:09
const PROGRESS_RE = /\[download\]\s+([\d.]+)%/;
const SPEED_RE = /at\s+([\d.]+\s*[KMG]?i?B\/s)/;
const ETA_RE = /ETA\s+([\d:]+)/;

function startDownload(job) {
  return new Promise((resolve) => {
    const ytdlpPath = resolveYtdlp();
    const ffmpeg = resolveFfmpeg();
    const outTemplate = path.join(DOWNLOADS_DIR, `${job.id}.%(ext)s`);
    const args = [
      '-f', job.formatSelector,
      '--no-warnings', '--no-playlist', '--no-check-certificates',
      '--newline',
      '-o', outTemplate,
    ];
    if (job.needsMerge) args.push('--merge-output-format', 'mp4');
    if (ffmpeg && ffmpeg.ffmpeg !== 'ffmpeg') args.push('--ffmpeg-location', path.dirname(ffmpeg.ffmpeg));
    args.push(`https://www.youtube.com/watch?v=${job.videoId}`);

    patchJob(job.id, { status: 'downloading', percent: 0, phase: 'downloading' });

    const p = spawn(ytdlpPath, args, { windowsHide: true });
    runningProcesses.set(job.id, p);
    let stderr = '';

    p.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r|\n/)) {
        if (!line.trim()) continue;
        const progressMatch = line.match(PROGRESS_RE);
        if (progressMatch) {
          const speedMatch = line.match(SPEED_RE);
          const etaMatch = line.match(ETA_RE);
          patchJob(job.id, {
            percent: Math.min(100, parseFloat(progressMatch[1])),
            speedText: speedMatch ? speedMatch[1] : null,
            etaText: etaMatch ? etaMatch[1] : null,
            phase: 'downloading',
          });
        } else if (/\[merger\]|merging formats|\[ffmpeg\]/i.test(line)) {
          patchJob(job.id, { phase: 'merging', percent: 100 });
        }
      }
    });
    p.stderr.on('data', (d) => { stderr += d.toString(); });

    p.on('error', (e) => {
      runningProcesses.delete(job.id);
      patchJob(job.id, { status: 'error', error: `Couldn't run yt-dlp (${e.message}).` });
      resolve();
    });

    p.on('close', (code) => {
      runningProcesses.delete(job.id);
      if (code === 0) {
        const files = fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.startsWith(job.id + '.'));
        const outputFile = files[0] || null;
        if (!outputFile) {
          patchJob(job.id, { status: 'error', error: 'yt-dlp finished but no output file was found - it may have been blocked by antivirus software or the merge step failed.' });
        } else {
          const stat = fs.statSync(path.join(DOWNLOADS_DIR, outputFile));
          patchJob(job.id, { status: 'done', percent: 100, phase: 'done', outputFile, finalSizeBytes: stat.size, finishedAt: Date.now() });
        }
      } else if (code === null) {
        // killed (cancel) - patchJob for 'cancelled' already happened at the call site
      } else {
        patchJob(job.id, { status: 'error', error: classifyYtdlpError(stderr) });
      }
      resolve();
    });
  });
}

async function startJob({ videoId, title, thumbnail, formatSelector, needsMerge, ext }) {
  const job = {
    id: genId(),
    videoId,
    title,
    thumbnail,
    formatSelector,
    needsMerge,
    ext,
    status: 'queued',
    percent: 0,
    phase: 'queued',
    speedText: null,
    etaText: null,
    error: null,
    outputFile: null,
    finalSizeBytes: null,
    createdAt: Date.now(),
    finishedAt: null,
  };
  await createJobRecord(job);
  // Fire and forget - the route returns the job id immediately, caller
  // polls GET /jobs/:id for progress, same pattern as timers' status
  // polling.
  startDownload(job).catch((e) => console.error('[ytdownload] unexpected error running job', job.id, e));
  return job;
}

async function cancelJob(id) {
  const job = await getJob(id);
  if (!job) return false;
  if (job.status === 'downloading' || job.status === 'queued') {
    killJob(id);
    await patchJob(id, { status: 'cancelled', error: 'Cancelled.' });
  }
  return true;
}

// Removes finished files nobody has grabbed within FINISHED_FILE_TTL_MS.
// Safe to call often - a no-op when nothing has expired. Mirrors
// AirDrop's cleanupExpired() in spirit (own TTL, own folder, called on
// its own interval from server.js) without importing anything from it.
async function cleanupOldFiles() {
  const data = read();
  const now = Date.now();
  const expired = data.jobs.filter((j) => j.status === 'done' && j.finishedAt && (now - j.finishedAt) > FINISHED_FILE_TTL_MS);
  if (expired.length === 0) return { removed: 0 };
  for (const j of expired) {
    if (j.outputFile) {
      try { fs.unlinkSync(path.join(DOWNLOADS_DIR, j.outputFile)); } catch (e) { /* already gone */ }
    }
  }
  const expiredIds = new Set(expired.map((j) => j.id));
  await update((d) => { d.jobs = d.jobs.filter((j) => !expiredIds.has(j.id)); });
  return { removed: expired.length };
}

module.exports = {
  DOWNLOADS_DIR,
  TOOLS_DIR,
  ensureTools,
  getSetupState,
  maybeSelfUpdateYtdlp,
  resolveYtdlp,
  resolveFfmpeg,
  lookupVideo,
  extractVideoId,
  buildQualityOptions, // exported for tests
  classifyYtdlpError, // exported for tests
  extractBinariesFromZip, // exported for tests
  downloadToFile, // exported for tests
  downloadToFileWithRetry, // exported for tests
  describeFetchError, // exported for tests
  ffmpegZipUrls, // exported for tests
  startJob,
  cancelJob,
  getJob,
  listJobs,
  countActive,
  removeJob,
  cleanupOldFiles,
};
