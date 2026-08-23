// Clock subsystem (Timer / Alarm / Stopwatch menus). Fully independent
// of Lesson Tracker/AirDrop - own store(s), own data file(s), no
// cross-references to anything else.
const express = require('express');
const store = require('../lib/timers-store');
const stopwatchStore = require('../lib/stopwatch-store');

const router = express.Router();

router.get('/', async (req, res) => {
  const timers = await store.listAll();
  const now = Date.now();
  res.json(timers.map((t) => ({
    id: t.id,
    label: t.label,
    kind: t.kind,
    status: t.status,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    durationMs: t.durationMs,
    msRemaining: Math.max(0, t.expiresAt - now),
  })));
});

router.post('/', async (req, res) => {
  const label = (req.body.label || '').trim() || 'Timer';
  const kind = req.body.kind === 'alarm' ? 'alarm' : 'timer';

  const activeCount = await store.countActive();
  if (activeCount >= store.MAX_ACTIVE_TIMERS) {
    return res.status(400).json({ error: `You already have ${store.MAX_ACTIVE_TIMERS} timers/alarms going - dismiss or remove one before adding another.` });
  }

  let expiresAt;
  let durationMs;
  const now = Date.now();

  if (kind === 'alarm') {
    const targetTime = req.body.targetTime; // "HH:MM" 24hr, local time
    if (!targetTime || !/^\d{1,2}:\d{2}$/.test(targetTime)) {
      return res.status(400).json({ error: 'Give the alarm a time in HH:MM format.' });
    }
    const [h, m] = targetTime.split(':').map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= now) target.setDate(target.getDate() + 1); // next occurrence if already passed today
    expiresAt = target.getTime();
    durationMs = expiresAt - now;
  } else {
    durationMs = Number(req.body.durationMs);
    if (!durationMs || durationMs <= 0) {
      return res.status(400).json({ error: 'Give the timer a duration greater than zero.' });
    }
    if (durationMs > 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Timers are capped at 24 hours.' });
    }
    expiresAt = now + durationMs;
  }

  const entry = {
    id: store.genId(),
    label,
    kind,
    status: 'running',
    createdAt: new Date(now).toISOString(),
    expiresAt,
    durationMs,
  };
  await store.create(entry);
  res.status(201).json(entry);
});

router.post('/:id/dismiss', async (req, res) => {
  const result = await store.dismiss(req.params.id);
  if (!result) return res.status(404).json({ error: 'Timer not found' });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await store.remove(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Stopwatch menu (v1.1.1). Mounted at /api/timers/stopwatches - still
// the same subsystem/router as Timer+Alarm above, just its own set of
// routes so the three menus stay easy to tell apart in this file.
// ---------------------------------------------------------------------

router.get('/stopwatches', async (req, res) => {
  const list = await stopwatchStore.listAll();
  const now = Date.now();
  res.json(list.map((t) => ({
    id: t.id,
    label: t.label,
    createdAt: t.createdAt,
    running: t.running,
    elapsedMs: stopwatchStore.elapsedMs(t, now),
    laps: t.laps,
  })));
});

router.post('/stopwatches', async (req, res) => {
  const activeCount = await stopwatchStore.countActive();
  if (activeCount >= stopwatchStore.MAX_ACTIVE_STOPWATCHES) {
    return res.status(400).json({ error: `You already have ${stopwatchStore.MAX_ACTIVE_STOPWATCHES} stopwatches going - remove one before adding another.` });
  }
  const entry = await stopwatchStore.create(req.body.label);
  res.status(201).json(entry);
});

router.post('/stopwatches/:id/pause', async (req, res) => {
  const result = await stopwatchStore.pause(req.params.id);
  if (!result) return res.status(404).json({ error: 'Stopwatch not found' });
  res.json({ ok: true });
});

router.post('/stopwatches/:id/resume', async (req, res) => {
  const result = await stopwatchStore.resume(req.params.id);
  if (!result) return res.status(404).json({ error: 'Stopwatch not found' });
  res.json({ ok: true });
});

router.post('/stopwatches/:id/lap', async (req, res) => {
  const result = await stopwatchStore.lap(req.params.id);
  if (!result) return res.status(404).json({ error: 'Stopwatch not found' });
  res.json({ ok: true });
});

router.post('/stopwatches/:id/reset', async (req, res) => {
  const result = await stopwatchStore.reset(req.params.id);
  if (!result) return res.status(404).json({ error: 'Stopwatch not found' });
  res.json({ ok: true });
});

router.delete('/stopwatches/:id', async (req, res) => {
  await stopwatchStore.remove(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
