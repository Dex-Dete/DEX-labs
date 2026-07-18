// v1.0.5: two related-but-separate things live here, both new:
//
// 1. Installation settings (GET/PUT /api/settings) - AirDrop's max usage
//    cap and save location, plus the `setupComplete` flag the frontend
//    uses to force a first-run visit to the Settings page before letting
//    the user go anywhere else. Backed by data/config.json via
//    lib/config-store.js (same file the port already lives in), so it
//    survives updates untouched, same as everything else in data/.
//
// 2. "What's new" update banner (GET /api/updates/latest, POST
//    /api/updates/ack) - fetches the latest GitHub release's notes so
//    the frontend can show them once after an update, then remembers
//    (server-side, via lastAcknowledgedUpdateVersion) that this version
//    has already been acknowledged so it doesn't nag on every visit.
const express = require('express');
const config = require('../lib/config-store');
const registry = require('../lib/subsystems-registry');
const VERSION = require('../package.json').version;

const REPO_OWNER = 'Dex-Dete';
const REPO_NAME = 'DEX-labs';
const RELEASES_PAGE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;

const router = express.Router();

function publicSettings() {
  const cfg = config.get();
  return {
    setupComplete: !!cfg.setupComplete,
    airdropMaxUsageGB: cfg.airdropMaxUsageGB,
    airdropSaveLocation: cfg.airdropSaveLocation || '',
  };
}

router.get('/', (req, res) => {
  res.json(publicSettings());
});

router.put('/', (req, res) => {
  const { airdropMaxUsageGB, airdropSaveLocation } = req.body || {};

  const gb = Number(airdropMaxUsageGB);
  if (!Number.isFinite(gb) || gb <= 0 || gb > 2000) {
    return res.status(400).json({ error: 'Max AirDrop usage must be a number between 1 and 2000 (GB).' });
  }

  let location = '';
  if (typeof airdropSaveLocation === 'string') {
    location = airdropSaveLocation.trim();
  }
  // Best-effort validation: if a location was given, make sure it's
  // actually creatable/writable before accepting it - same reasoning as
  // the fallback already built into airdrop-store.js's getFilesDir(),
  // just surfaced as a clear error here instead of a silent fallback.
  if (location) {
    const fs = require('fs');
    try {
      if (!fs.existsSync(location)) fs.mkdirSync(location, { recursive: true });
      fs.accessSync(location, fs.constants.W_OK);
    } catch (e) {
      return res.status(400).json({ error: `That save location isn't usable: ${e.message}` });
    }
  }

  const saved = config.set({
    airdropMaxUsageGB: gb,
    airdropSaveLocation: location,
    setupComplete: true,
  });

  res.json(publicSettings());
});

// ---------------- Subsystem visibility ("show/hide menu") ----------------
// See lib/subsystems-registry.js for the full explanation and the
// pattern a future session follows to add subsystem #5, #6, ... #30+
// without touching this file.
router.get('/subsystems', (req, res) => {
  const cfg = config.get();
  res.json({
    subsystems: registry.all(),
    hiddenSubsystems: cfg.hiddenSubsystems || [],
    defaultLandingSubsystem: cfg.defaultLandingSubsystem || 'lessons',
  });
});

router.put('/subsystems', (req, res) => {
  const { hiddenSubsystems, defaultLandingSubsystem } = req.body || {};
  if (!Array.isArray(hiddenSubsystems)) {
    return res.status(400).json({ error: 'hiddenSubsystems must be an array of subsystem ids.' });
  }

  const validIds = registry.ids();
  // Silently drop anything that isn't a real, currently-known subsystem
  // id, rather than erroring - keeps this forgiving of stale ids from an
  // older registry (e.g. a subsystem that got removed) instead of
  // blocking the whole save over it.
  const cleanedHidden = hiddenSubsystems.filter((id) => validIds.includes(id));

  // Guard: never allow hiding every single subsystem - the user needs
  // somewhere to land. (Settings is always reachable regardless, but
  // leaving zero real subsystems visible would be a confusing, almost
  // certainly accidental, dead end.)
  if (cleanedHidden.length >= validIds.length) {
    return res.status(400).json({ error: 'At least one subsystem must stay visible.' });
  }

  let landing = typeof defaultLandingSubsystem === 'string' && defaultLandingSubsystem
    ? defaultLandingSubsystem
    : (config.get().defaultLandingSubsystem || 'lessons');
  // If the requested landing subsystem doesn't exist or was just hidden,
  // fall back to the first one that's staying visible instead of
  // rejecting the whole request - this is exactly the "what shows
  // instead of Lesson Tracker" case the feature exists for, so it should
  // just work rather than erroring.
  if (!validIds.includes(landing) || cleanedHidden.includes(landing)) {
    landing = validIds.find((id) => !cleanedHidden.includes(id)) || 'lessons';
  }

  const saved = config.set({ hiddenSubsystems: cleanedHidden, defaultLandingSubsystem: landing });
  res.json({
    subsystems: registry.all(),
    hiddenSubsystems: saved.hiddenSubsystems,
    defaultLandingSubsystem: saved.defaultLandingSubsystem,
  });
});

// ---------------- Update announcement ----------------
// Simple in-process cache so a burst of page loads (multiple devices on
// the LAN opening the site around the same time) doesn't hammer GitHub's
// API - the release notes for a given version don't change minute to
// minute.
let releaseCache = { fetchedAt: 0, data: null };
const CACHE_MS = 10 * 60 * 1000; // 10 minutes

async function fetchLatestRelease() {
  if (releaseCache.data && Date.now() - releaseCache.fetchedAt < CACHE_MS) {
    return releaseCache.data;
  }
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'DEX-Labs-App', Accept: 'application/vnd.github+json' },
  });
  if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);
  const json = await resp.json();
  const data = {
    tag: (json.tag_name || '').replace(/^v/i, ''),
    name: json.name || json.tag_name || '',
    body: json.body || '',
    htmlUrl: json.html_url || RELEASES_PAGE_URL,
    publishedAt: json.published_at || null,
  };
  releaseCache = { fetchedAt: Date.now(), data };
  return data;
}

// GET /api/updates/latest - tells the frontend whether to show the "what's
// new" banner and, if so, with what content. `shouldShow` is true only
// when: (a) we could reach GitHub, (b) that release's tag matches the
// version actually running right now (so we never show notes for a
// release that hasn't been installed yet), and (c) the user hasn't
// already clicked OK for this version.
router.get('/updates/latest', async (req, res) => {
  try {
    const release = await fetchLatestRelease();
    const cfg = config.get();
    const alreadyAcked = cfg.lastAcknowledgedUpdateVersion === VERSION;
    const matchesRunningVersion = release.tag === VERSION;
    res.json({
      currentVersion: VERSION,
      releasesUrl: RELEASES_PAGE_URL,
      release,
      shouldShow: matchesRunningVersion && !alreadyAcked,
    });
  } catch (e) {
    // Not being able to reach GitHub just means "don't show the banner
    // right now" - never break the rest of the site over this.
    res.json({
      currentVersion: VERSION,
      releasesUrl: RELEASES_PAGE_URL,
      release: null,
      shouldShow: false,
      error: e.message,
    });
  }
});

// POST /api/updates/ack - "OK, stop showing this." Remembers the CURRENT
// running version as acknowledged, so the banner only reappears once the
// app updates again to something newer.
router.post('/updates/ack', (req, res) => {
  config.set({ lastAcknowledgedUpdateVersion: VERSION });
  res.json({ ok: true, acknowledgedVersion: VERSION });
});

module.exports = router;
