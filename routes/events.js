// Events API - v1.3.0. Lives inside the Clock (timers) subsystem as the
// new "Events" tab, and also feeds Standby Mode's events section.
// Mounted at /api/events - kept as its own top-level route file (rather
// than folded into routes/timers.js) since it has its own store and no
// real overlap with Timer/Alarm/Stopwatch logic, matching how AirDrop,
// Schedule, etc. each get their own route file.
const express = require('express');
const events = require('../lib/events-store');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', (req, res) => {
  res.json({ events: events.list() });
});

router.get('/upcoming', (req, res) => {
  res.json({ events: events.upcoming() });
});

router.post('/', async (req, res) => {
  const name = (req.body.name || '').trim();
  const targetDate = (req.body.targetDate || '').trim();

  if (!name) return res.status(400).json({ error: 'Event name is required.' });
  if (!DATE_RE.test(targetDate) || Number.isNaN(new Date(targetDate).getTime())) {
    return res.status(400).json({ error: 'Target date must be a valid date (YYYY-MM-DD).' });
  }

  const event = await events.add({ name, targetDate });
  res.status(201).json(event);
});

router.delete('/:id', async (req, res) => {
  const ok = await events.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Event not found.' });
  res.json({ ok: true });
});

module.exports = router;
