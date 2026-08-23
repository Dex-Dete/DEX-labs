// Compact diagnostic tool - shows exactly what YouTube's playlist page
// currently looks like from the inside, without dumping megabytes of
// text. Run this and paste the ENTIRE output back - it's short by design.
//
//   node inspect-playlist.js "https://www.youtube.com/playlist?list=XXXX"
//
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CONSENT_COOKIE = 'CONSENT=YES+cb.20210328-17-p0.en+FX+410';

function collectKeyNames(obj, set, depth) {
  if (depth > 25) return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectKeyNames(item, set, depth + 1);
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      set.add(k);
      collectKeyNames(obj[k], set, depth + 1);
    }
  }
}

function safeGet(obj, path) {
  return path.reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.log('Usage: node inspect-playlist.js "https://www.youtube.com/playlist?list=XXXX"');
    process.exit(1);
  }
  let playlistId;
  try {
    playlistId = new URL(url).searchParams.get('list');
  } catch (e) {
    console.log('Not a valid URL.');
    process.exit(1);
  }
  console.log('Node version:', process.version);
  console.log('Playlist ID:', playlistId);
  console.log('---');

  const res = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en&gl=US`, {
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: CONSENT_COOKIE,
    },
  });
  console.log('HTTP status:', res.status);
  const html = await res.text();
  console.log('HTML length:', html.length);

  const match =
    html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s) ||
    html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s) ||
    html.match(/window\["ytInitialData"\]\s*=\s*(\{.+?\});/s);

  if (!match) {
    console.log('Could NOT extract ytInitialData at all.');
    return;
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    console.log('JSON.parse FAILED:', e.message);
    return;
  }
  console.log('Top-level keys:', Object.keys(data).join(', '));
  console.log('---');

  // Instead of guessing specific renderer names, collect EVERY key name
  // that appears anywhere in the document, then show the ones that look
  // relevant to videos/playlists/items. This finds new/renamed renderers
  // (e.g. YouTube's newer "ViewModel"-style objects) without needing to
  // already know what they're called.
  const allKeys = new Set();
  collectKeyNames(data, allKeys, 0);
  const candidates = [...allKeys].filter((k) => /video|lockup|playlist|item|renderer|viewmodel|content/i.test(k));
  console.log(`All key names anywhere in the page matching video/lockup/playlist/item/renderer/viewmodel/content (${candidates.length} found):`);
  candidates.sort().forEach((k) => console.log('  ', k));
  console.log('---');

  // Drill into the one path we know exists (confirmed by the previous
  // run) and show exactly what's inside it now.
  const itemSectionContents = safeGet(data, [
    'contents', 'twoColumnBrowseResultsRenderer', 'tabs', 0, 'tabRenderer',
    'content', 'sectionListRenderer', 'contents', 0, 'itemSectionRenderer', 'contents',
  ]);
  if (!itemSectionContents) {
    console.log('Could not reach contents.twoColumnBrowseResultsRenderer...itemSectionRenderer.contents');
  } else {
    console.log(`itemSectionRenderer.contents is an array of length ${itemSectionContents.length}.`);
    console.log('Keys of item [0]:', itemSectionContents[0] ? Object.keys(itemSectionContents[0]) : '(empty)');
    if (itemSectionContents[0]) {
      const dump = JSON.stringify(itemSectionContents[0]);
      console.log('First 1500 chars of item [0]:');
      console.log(dump.slice(0, 1500));
    }
  }
}

main().catch((e) => console.log('FATAL:', e && e.stack || e));
