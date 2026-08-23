// Daily Schedule subsystem. Fully independent of Lesson Tracker/AirDrop/
// Timers - own store, own data file, no cross-references.
const express = require('express');
const store = require('../lib/schedule-store');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(store.read());
});

router.put('/', (req, res) => {
  const days = req.body.days;
  if (!Array.isArray(days)) {
    return res.status(400).json({ error: 'Expected a "days" array of 3 rows.' });
  }
  const saved = store.save(days);
  res.json(saved);
});

module.exports = router;
