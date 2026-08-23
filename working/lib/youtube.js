// Handles turning a pasted YouTube URL (single video OR playlist) into
// one or more lesson entries. No Google API key required.
//
// Playlist reading uses TWO independent strategies, tried in order:
//   1. `@distube/ytpl` (an actively-maintained scraper library)
//   2. A direct fetch of the playlist page + our own JSON parsing
// If #1 fails for ANY reason (not installed, blocked, package bug,
// YouTube layout change it hasn't caught up with yet), we fall back to
// #2 automatically instead of just giving up. #2 uses the exact same
// `fetch()` mechanism that already works for single-video adding on
// this network, so it doesn't depend on any extra package at all.
//
// Every failure is logged in detail to the console (visible via
// debug.bat, or in logs.txt) so if this ever still fails, the real
// reason is visible instead of a guess.

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CONSENT_COOKIE = 'CONSENT=YES+cb.20210328-17-p0.en+FX+410';

// Links pasted from phones (WhatsApp especially) sometimes carry invisible
// junk stuck to the end - object-replacement characters (U+FFFC, shows up
// as a box/emoji placeholder), zero-width spaces/joiners, bidi control
// marks, stray control bytes. `String.prototype.trim()` doesn't touch any
// of these, so a link that LOOKS clean when pasted can still fail to
// parse as a URL (or silently turn into a "playlist" / different video
// than intended) once it hits `new URL()`. Strip them before anything
// else ever sees the URL.
function sanitizeUrl(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF\uFFFC]/g, '')
    .trim();
}

let _ytpl = null;
let _ytplLoadError = null;
function getYtpl() {
  if (_ytpl) return _ytpl;
  if (_ytplLoadError) throw _ytplLoadError;
  try {
    _ytpl = require('@distube/ytpl');
    return _ytpl;
  } catch (e) {
    _ytplLoadError = e;
    throw e;
  }
}

function extractVideoId(rawUrl) {
  const url = sanitizeUrl(rawUrl);
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
      if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2];
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2];
    }
  } catch (e) {
    /* not a valid URL */
  }
  return null;
}

function extractPlaylistId(rawUrl) {
  try {
    const u = new URL(sanitizeUrl(rawUrl));
    return u.searchParams.get('list');
  } catch (e) {
    return null;
  }
}

// Personal/auto-generated playlists (Watch Later, Liked videos, Mixes/Radio)
// can't be read anonymously - YouTube requires you to be logged in as the
// owner. Recognize these up front so we can give a clear error instead of
// a confusing failure from either strategy below.
function isUnresolvablePlaylistId(playlistId) {
  if (!playlistId) return false;
  if (playlistId === 'WL' || playlistId === 'LL') return true;
  if (/^RD/.test(playlistId)) return true;
  return false;
}

function thumbnailFor(videoId) {
  return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
}

function friendlyError(msg) {
  const err = new Error(msg);
  err.friendly = true;
  return err;
}

// Fetch title for a single video via oEmbed (no API key needed).
// Falls back gracefully if there's no internet access at the moment.
async function fetchVideoMeta(rawUrl) {
  const url = sanitizeUrl(rawUrl);
  const videoId = extractVideoId(url);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      return {
        videoId,
        title: data.title || url,
        thumbnail: data.thumbnail_url || thumbnailFor(videoId),
      };
    }
  } catch (e) {
    // no internet right now, or YouTube unreachable from this LAN - that's OK
  }
  return { videoId, title: url, thumbnail: thumbnailFor(videoId) };
}

// Extracts a JSON-escaped string value for `"fieldName":"..."` out of raw
// HTML/JS text without needing to parse the whole (often huge) enclosing
// object - handles escaped quotes/backslashes within the string correctly.
function extractEscapedStringField(html, fieldName) {
  const re = new RegExp(`"${fieldName}":"((?:[^"\\\\]|\\\\.)*)"`, 's');
  const match = html.match(re);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch (e) {
    return match[1];
  }
}

// On-demand lookup for a video's full title + description, used only
// when someone clicks "Details" on a lesson (not fetched automatically
// for every video, to keep adding lessons fast).
async function fetchVideoDetails(videoId) {
  if (!videoId) throw friendlyError('No video ID on file for this lesson.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let html;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`, {
      signal: controller.signal,
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: CONSENT_COOKIE,
      },
    });
    if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw friendlyError('Could not reach YouTube to fetch details right now. Check your internet connection.');
  } finally {
    clearTimeout(timeout);
  }

  const description = extractEscapedStringField(html, 'shortDescription');
  let title = extractEscapedStringField(html, 'title');
  // The word "title" appears many times in a watch page; the first match
  // isn't always the video's own title, so sanity-check it's non-trivial.
  if (title && title.length > 300) title = null;

  if (!description && !title) {
    throw friendlyError('YouTube did not return any details for this video (it may be private, deleted, or region-locked).');
  }
  return { title, description: description || '(No description provided for this video.)' };
}

function bestThumbnailOf(item, videoId) {
  if (item.bestThumbnail && item.bestThumbnail.url) return item.bestThumbnail.url;
  if (Array.isArray(item.thumbnails) && item.thumbnails.length) {
    return item.thumbnails[item.thumbnails.length - 1].url;
  }
  if (item.thumbnail) return item.thumbnail;
  return thumbnailFor(videoId);
}

const VIDEO_ID_RE = /^[\w-]{11}$/;

// Deep-search helpers for YouTube's newer "ViewModel" JSON shapes, which
// don't have a small fixed set of field names the way the old Renderer
// objects did. Rather than hard-coding one exact path (which will just
// break again next time YouTube tweaks it), these walk the object
// looking for a plausible answer, so small future renames are more
// likely to keep working without another round of manual fixing.
function deepFindVideoId(obj, depth) {
  if (depth > 12 || !obj || typeof obj !== 'object') return null;
  if (typeof obj.videoId === 'string' && VIDEO_ID_RE.test(obj.videoId)) return obj.videoId;
  if (typeof obj.animationActivationTargetId === 'string' && VIDEO_ID_RE.test(obj.animationActivationTargetId)) {
    return obj.animationActivationTargetId;
  }
  for (const k of Object.keys(obj)) {
    const found = deepFindVideoId(obj[k], depth + 1);
    if (found) return found;
  }
  return null;
}

function deepFindTitleText(obj, depth) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    if (/title/i.test(k)) {
      const v = obj[k];
      if (v && typeof v === 'object') {
        if (typeof v.content === 'string' && v.content.trim()) return v.content.trim();
        if (typeof v.simpleText === 'string' && v.simpleText.trim()) return v.simpleText.trim();
        if (Array.isArray(v.runs) && v.runs[0] && v.runs[0].text) return v.runs[0].text;
      } else if (typeof v === 'string' && v.trim()) {
        return v.trim();
      }
    }
  }
  for (const k of Object.keys(obj)) {
    const found = deepFindTitleText(obj[k], depth + 1);
    if (found) return found;
  }
  return null;
}

function deepFindThumbnailSource(obj, depth) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.sources) && obj.sources.length) {
    const last = obj.sources[obj.sources.length - 1];
    if (last && last.url) return last.url;
  }
  for (const k of Object.keys(obj)) {
    if (k === 'overlays') continue; // skip overlay badges/buttons - not the main image
    const found = deepFindThumbnailSource(obj[k], depth + 1);
    if (found) return found;
  }
  return null;
}

// Newer YouTube playlist rows: itemSectionRenderer.contents[i].lockupViewModel
// (replaces the old playlistVideoRenderer). Known-good paths are tried
// first; deep search is the fallback for whatever shifts next.
function extractFromLockupViewModel(lockup) {
  const videoId = (typeof lockup.contentId === 'string' && VIDEO_ID_RE.test(lockup.contentId))
    ? lockup.contentId
    : deepFindVideoId(lockup, 0);
  if (!videoId) return null;

  const metaVM = lockup.metadata && lockup.metadata.lockupMetadataViewModel;
  let title = null;
  if (metaVM && metaVM.title) {
    title = metaVM.title.content ||
      (metaVM.title.runs && metaVM.title.runs[0] && metaVM.title.runs[0].text) ||
      metaVM.title.simpleText || null;
  }
  if (!title) title = deepFindTitleText(lockup, 0);

  const thumbnail = deepFindThumbnailSource(lockup.contentImage || lockup, 0) || thumbnailFor(videoId);

  return {
    videoId,
    title: title || 'Untitled video',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail,
  };
}

function deepFindArrayByKey(obj, key, depth) {
  if (depth > 12 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj[key])) return obj[key];
  for (const k of Object.keys(obj)) {
    const found = deepFindArrayByKey(obj[k], key, depth + 1);
    if (found) return found;
  }
  return null;
}

function findContinuationToken(obj, depth) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  if (obj.continuationCommand && typeof obj.continuationCommand.token === 'string') {
    return obj.continuationCommand.token;
  }
  for (const k of Object.keys(obj)) {
    const found = findContinuationToken(obj[k], depth + 1);
    if (found) return found;
  }
  return null;
}

function findContinuationItemsArray(responseJson) {
  const actions = responseJson.onResponseReceivedActions || responseJson.onResponseReceivedEndpoints;
  if (Array.isArray(actions)) {
    for (const action of actions) {
      const items = (action.appendContinuationItemsAction && action.appendContinuationItemsAction.continuationItems) ||
        (action.reloadContinuationItemsCommand && action.reloadContinuationItemsCommand.continuationItems);
      if (Array.isArray(items)) return items;
    }
  }
  return deepFindArrayByKey(responseJson, 'continuationItems', 0);
}

function extractApiKeyAndVersion(html) {
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const versionMatch = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || html.match(/"clientVersion":"([^"]+)"/);
  return {
    apiKey: apiKeyMatch ? apiKeyMatch[1] : null,
    clientVersion: versionMatch ? versionMatch[1] : '2.20240101.00.00',
  };
}

// Processes one list of "row" items (either the initial page's
// itemSectionRenderer.contents, or a continuation page's
// continuationItems - same shape either way), pushing extracted videos
// into `itemsAccumulator` and returning a continuation token if the list
// ends with one (meaning there are more pages beyond this one).
function processContentItems(itemList, itemsAccumulator) {
  let continuationToken = null;
  for (const isItem of itemList) {
    // Legacy shape (pre-2025ish): wrapped in playlistVideoListRenderer
    const plist = isItem && isItem.playlistVideoListRenderer && isItem.playlistVideoListRenderer.contents;
    if (plist) {
      for (const vidWrap of plist) {
        const v = vidWrap && vidWrap.playlistVideoRenderer;
        if (!v || !v.videoId) continue;
        const titleText = (v.title && (
          (v.title.runs && v.title.runs[0] && v.title.runs[0].text) ||
          v.title.simpleText
        )) || 'Untitled video';
        const thumbs = v.thumbnail && v.thumbnail.thumbnails;
        const thumbnail = (thumbs && thumbs.length) ? thumbs[thumbs.length - 1].url : thumbnailFor(v.videoId);
        itemsAccumulator.push({
          videoId: v.videoId,
          title: titleText,
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          thumbnail,
        });
      }
      continue;
    }

    // Newer shape (YouTube's "ViewModel" redesign): each row IS a video.
    const lockup = isItem && isItem.lockupViewModel;
    if (lockup) {
      const extracted = extractFromLockupViewModel(lockup);
      if (extracted) itemsAccumulator.push(extracted);
      continue;
    }

    // Marks "there's more - fetch this token to get the next batch",
    // appears as the last row once a playlist has more videos than fit
    // on the initial page (~100).
    const contItem = isItem && isItem.continuationItemRenderer;
    if (contItem) {
      const token = findContinuationToken(contItem, 0);
      if (token) continuationToken = token;
    }
  }
  return continuationToken;
}

// Fetches one additional page of playlist items using a continuation
// token (the same mechanism your browser uses for infinite-scroll).
// Returns null (not throws) on any failure - a partial playlist is far
// better than losing the whole result over one bad page.
async function fetchContinuationPage(token, apiKey, clientVersion) {
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: CONSENT_COOKIE,
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': clientVersion,
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } },
        continuation: token,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const items = findContinuationItemsArray(json);
    return items || [];
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const MAX_CONTINUATION_PAGES = 30; // ~30x100 = up to ~3000 videos, generous headroom

// ---------- Strategy 1: @distube/ytpl ----------
async function tryYtplStrategy(playlistId) {
  const ytpl = getYtpl(); // throws if the package isn't installed - caller catches it
  const options = {
    limit: Infinity,
    gl: 'US',
    hl: 'en',
    requestOptions: {
      headers: {
        cookie: CONSENT_COOKIE,
        'user-agent': DESKTOP_UA,
      },
    },
  };
  const playlist = await ytpl(playlistId, options);
  if (!playlist || !playlist.items || playlist.items.length === 0) {
    throw new Error('ytpl returned zero items');
  }
  return {
    playlistTitle: playlist.title || 'Playlist',
    items: playlist.items.map((item) => {
      const videoId = item.id || item.videoID || item.videoId || null;
      return {
        videoId,
        title: item.title || item.name || 'Untitled video',
        url: item.shortUrl || item.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null),
        thumbnail: bestThumbnailOf(item, videoId),
      };
    }),
  };
}

// ---------- Strategy 2: fetch the playlist page ourselves ----------
// This deliberately does NOT depend on any playlist-scraping package -
// it fetches the public playlist page HTML (same as a browser would)
// and pulls the embedded `ytInitialData` JSON out of it directly.
async function tryDirectFetchStrategy(playlistId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let html;
  try {
    const res = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en&gl=US&persist_hl=1&persist_gl=1`, {
      signal: controller.signal,
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: CONSENT_COOKIE,
      },
    });
    if (!res.ok) {
      throw new Error(`YouTube returned HTTP ${res.status} for the playlist page`);
    }
    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const match =
    html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s) ||
    html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s) ||
    html.match(/window\["ytInitialData"\]\s*=\s*(\{.+?\});/s);
  if (!match) {
    throw new Error('Could not find playlist data in the page (YouTube may have changed its page layout)');
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    throw new Error(`Found playlist data but could not parse it as JSON: ${e.message}`);
  }

  const title =
    (data.microformat && data.microformat.microformatDataRenderer && data.microformat.microformatDataRenderer.title) ||
    (data.header && data.header.playlistHeaderRenderer && data.header.playlistHeaderRenderer.title &&
      (data.header.playlistHeaderRenderer.title.simpleText ||
        (data.header.playlistHeaderRenderer.title.runs && data.header.playlistHeaderRenderer.title.runs[0] && data.header.playlistHeaderRenderer.title.runs[0].text))) ||
    'Playlist';

  const items = [];
  let continuationToken = null;
  try {
    const tabs = data.contents.twoColumnBrowseResultsRenderer.tabs;
    for (const tab of tabs) {
      const sectionList = tab && tab.tabRenderer && tab.tabRenderer.content &&
        tab.tabRenderer.content.sectionListRenderer && tab.tabRenderer.content.sectionListRenderer.contents;
      if (!sectionList) continue;
      for (const section of sectionList) {
        const itemSection = section && section.itemSectionRenderer && section.itemSectionRenderer.contents;
        if (!itemSection) continue;
        const token = processContentItems(itemSection, items);
        if (token) continuationToken = token;
      }
    }
  } catch (e) {
    throw new Error(`Playlist data was found but had an unexpected shape: ${e.message}`);
  }

  if (items.length === 0) {
    throw new Error('Parsed the playlist page successfully but found zero videos in it');
  }

  // Playlist has more videos than fit on the initial page - follow
  // continuation tokens (the same mechanism as browser infinite-scroll)
  // to get the rest. Any failure here just stops early with whatever was
  // already gathered - never throws away a partial result.
  if (continuationToken) {
    const { apiKey, clientVersion } = extractApiKeyAndVersion(html);
    if (apiKey) {
      let pages = 0;
      while (continuationToken && pages < MAX_CONTINUATION_PAGES) {
        pages++;
        const pageItems = await fetchContinuationPage(continuationToken, apiKey, clientVersion);
        if (!pageItems) {
          console.error(`[playlist] continuation page ${pages} failed - stopping with ${items.length} videos so far.`);
          break;
        }
        const beforeCount = items.length;
        continuationToken = processContentItems(pageItems, items);
        console.log(`[playlist] continuation page ${pages}: +${items.length - beforeCount} videos (${items.length} total so far).`);
        if (items.length === beforeCount) break; // no progress - avoid spinning forever
      }
    } else {
      console.error('[playlist] Found a continuation token but no INNERTUBE_API_KEY on the page - cannot fetch further pages.');
    }
  }

  return { playlistTitle: title, items };
}

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---------- Strategy 3: YouTube's official RSS feed ----------
// This is a stable, documented YouTube feature (not a scraped internal
// page), so it can't break the way the two strategies above can when
// YouTube tweaks its page layout. The tradeoff: YouTube hard-caps this
// feed at the ~15 most recently added videos, so this is only ever a
// PARTIAL result for playlists bigger than that - used as a last resort
// so something works rather than nothing.
async function tryRssFeedStrategy(playlistId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let xml;
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': DESKTOP_UA },
    });
    if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status} for the RSS feed`);
    xml = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const feedTitleMatch = xml.match(/<title>([^<]*)<\/title>/);
  const feedTitle = feedTitleMatch ? decodeXmlEntities(feedTitleMatch[1]) : 'Playlist';

  const entryChunks = xml.split('<entry>').slice(1);
  const items = [];
  for (const chunk of entryChunks) {
    const idMatch = chunk.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!idMatch) continue;
    const videoId = idMatch[1];
    const titleMatch = chunk.match(/<title>([^<]*)<\/title>/) || chunk.match(/<media:title>([^<]*)<\/media:title>/);
    const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : 'Untitled video';
    const thumbMatch = chunk.match(/<media:thumbnail url="([^"]+)"/);
    const thumbnail = thumbMatch ? thumbMatch[1] : thumbnailFor(videoId);
    items.push({ videoId, title, url: `https://www.youtube.com/watch?v=${videoId}`, thumbnail });
  }

  if (items.length === 0) {
    throw new Error('RSS feed returned zero entries');
  }

  return { playlistTitle: feedTitle, items };
}

// Expand a playlist URL into all of its videos, trying three independent
// strategies in order and logging exactly what happened with each one.
async function fetchPlaylistItems(url) {
  const playlistId = extractPlaylistId(url);
  if (!playlistId) return null;

  if (isUnresolvablePlaylistId(playlistId)) {
    throw friendlyError(
      "This looks like a personal playlist (Watch Later, Liked Videos, or an auto-generated Mix/Radio). " +
      "Those can't be read without being logged in as the owner - use a public playlist link instead."
    );
  }

  const errors = [];

  try {
    console.log(`[playlist] Trying @distube/ytpl for ${playlistId}...`);
    const result = await tryYtplStrategy(playlistId);
    console.log(`[playlist] @distube/ytpl succeeded: ${result.items.length} videos.`);
    return { playlistId, playlistTitle: result.playlistTitle, items: result.items, partial: false };
  } catch (e) {
    console.error(`[playlist] @distube/ytpl failed for ${playlistId}: ${(e && e.stack) || e}`);
    errors.push(e);
  }

  try {
    console.log(`[playlist] Trying direct page fetch for ${playlistId}...`);
    const result = await tryDirectFetchStrategy(playlistId);
    console.log(`[playlist] Direct page fetch succeeded: ${result.items.length} videos.`);
    return { playlistId, playlistTitle: result.playlistTitle, items: result.items, partial: false };
  } catch (e) {
    console.error(`[playlist] Direct page fetch failed for ${playlistId}: ${(e && e.stack) || e}`);
    errors.push(e);
  }

  try {
    console.log(`[playlist] Trying RSS feed for ${playlistId}...`);
    const result = await tryRssFeedStrategy(playlistId);
    console.log(`[playlist] RSS feed succeeded (PARTIAL - latest videos only): ${result.items.length} videos.`);
    return { playlistId, playlistTitle: result.playlistTitle, items: result.items, partial: true };
  } catch (e) {
    console.error(`[playlist] RSS feed failed for ${playlistId}: ${(e && e.stack) || e}`);
    errors.push(e);
  }

  // All three strategies failed - build one clear, honest message. Full
  // detail is always in logs.txt (run debug.bat to see it live).
  const messages = errors.map((e) => (e && e.message) || String(e));
  let friendly;
  if (messages.some((m) => /private/i.test(m))) {
    friendly = "That playlist is private and can't be read anonymously. Make it unlisted or public and try again.";
  } else if (messages.some((m) => /not found|404/i.test(m))) {
    friendly = "That playlist link doesn't seem to exist anymore. Double-check the URL.";
  } else if (messages.some((m) => /403|forbidden|blocked/i.test(m))) {
    friendly = 'YouTube blocked every attempt to read this playlist. Check your internet connection and try again in a moment - if it keeps happening, check logs.txt for the exact error.';
  } else {
    friendly = `Could not read that playlist after three different attempts. Details are in logs.txt (run debug.bat to see them live). Last error: ${messages[messages.length - 1]}`;
  }
  throw friendlyError(friendly);
}

function isPlaylistUrl(url) {
  return !!extractPlaylistId(url);
}

module.exports = {
  sanitizeUrl,
  extractVideoId,
  extractPlaylistId,
  fetchVideoMeta,
  fetchVideoDetails,
  fetchPlaylistItems,
  isPlaylistUrl,
  thumbnailFor,
  extractFromLockupViewModel,
};
