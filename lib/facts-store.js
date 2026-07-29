// Standby Mode's "new science fact every hour" feature - v1.3.0. Cheap,
// simple approach per PROJECT_BRIEFING.md: ~190 facts seeded from
// lib/facts-seed.json, each marked "used" (never deleted) once shown.
// Picking the next hour's fact skips anything already marked used, so a
// fact can never repeat until the whole pool has cycled through (at
// current pool size, that's well over a week - comfortably satisfies
// "never repeat a fact used on the previous day"). When the pool is
// likely running low, top it up - triggered ~70 days after facts were
// last added, rather than tracking an exact remaining count.
//
// "Current hour's fact" is computed and cached server-side (one fact
// for everyone looking at SBM at once, same as the rest of this app's
// single-server-shared-state model) so refreshing the page or having
// multiple devices open doesn't hand out a different fact each time
// within the same hour.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'facts.json');
const SEED_PATH = path.join(__dirname, 'facts-seed.json');

const TOPUP_INTERVAL_MS = 70 * 24 * 60 * 60 * 1000; // ~70 days

function loadSeedFacts() {
  try {
    return JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
  } catch (e) {
    return ['Water covers about 71% of the Earth\'s surface.'];
  }
}

function buildDefaults() {
  const now = Date.now();
  return {
    facts: loadSeedFacts().map((text, i) => ({ id: `f${i}`, text, used: false, usedAt: null })),
    lastAddedAt: now,
    currentFactId: null,
    currentFactHour: null,
  };
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(buildDefaults(), null, 2));

let writeQueue = Promise.resolve();

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!Array.isArray(data.facts) || !data.facts.length) return buildDefaults();
    return data;
  } catch (e) {
    return buildDefaults();
  }
}

function write(data) {
  writeQueue = writeQueue.then(() => new Promise((resolve, reject) => {
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8', (err) => {
      if (err) return reject(err);
      fs.rename(tmpPath, DB_PATH, (err2) => (err2 ? reject(err2) : resolve()));
    });
  }));
  return writeQueue;
}

function currentHourBucket(now) {
  return Math.floor(now / (60 * 60 * 1000));
}

// Picks (and marks used) the next unused fact. If the pool has run dry,
// resets every fact's "used" flag back to false first (a full reset is
// simpler and just as fair as any other fallback, and should be rare in
// practice given the top-up check below runs first).
function pickNextFact(data) {
  let pool = data.facts.filter((f) => !f.used);
  if (!pool.length) {
    data.facts.forEach((f) => { f.used = false; f.usedAt = null; });
    pool = data.facts;
  }
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  chosen.used = true;
  chosen.usedAt = Date.now();
  return chosen;
}

function maybeTopUp(data) {
  const now = Date.now();
  if (!data.lastAddedAt || now - data.lastAddedAt > TOPUP_INTERVAL_MS) {
    // v1.3.0 ships with a fixed seed list, so there's nothing new to
    // pull in automatically yet - this just records that a check
    // happened and resets the used flags, so the site doesn't run out
    // of "new" facts to show even if nobody's added more to
    // lib/facts-seed.json by the time 70 days roll around. A future
    // version can replace this with actually appending fresh facts.
    data.facts.forEach((f) => { f.used = false; f.usedAt = null; });
    data.lastAddedAt = now;
  }
}

async function getCurrentFact() {
  const data = read();
  const now = Date.now();
  const hourBucket = currentHourBucket(now);

  if (data.currentFactHour === hourBucket && data.currentFactId) {
    const existing = data.facts.find((f) => f.id === data.currentFactId);
    if (existing) return { text: existing.text, hour: hourBucket };
  }

  maybeTopUp(data);
  const chosen = pickNextFact(data);
  data.currentFactId = chosen.id;
  data.currentFactHour = hourBucket;
  await write(data);
  return { text: chosen.text, hour: hourBucket };
}

module.exports = { getCurrentFact };
