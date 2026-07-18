// Study subsystem - fully independent of every other subsystem (own
// store, own data file), same "one router file per subsystem" pattern
// as routes/schedule.js / routes/timers.js.
const express = require('express');
const store = require('../lib/study-store');

const router = express.Router();

function handleError(res, err, fallbackStatus = 400) {
  res.status(fallbackStatus).json({ error: (err && err.message) || 'Something went wrong' });
}

// ---------------- Subjects ----------------

router.get('/subjects', async (req, res) => {
  res.json(await store.listSubjects());
});

router.post('/subjects', async (req, res) => {
  try {
    res.status(201).json(await store.addSubject(req.body.name));
  } catch (e) { handleError(res, e); }
});

router.patch('/subjects/:id', async (req, res) => {
  try {
    res.json(await store.renameSubject(req.params.id, req.body.name));
  } catch (e) { handleError(res, e); }
});

router.delete('/subjects/:id', async (req, res) => {
  try {
    await store.deleteSubject(req.params.id);
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
});

// ---------------- Pomodoro settings (saved forever) ----------------

router.get('/settings', async (req, res) => {
  res.json(await store.getSettings());
});

router.put('/settings', async (req, res) => {
  try {
    res.json(await store.setSettings(req.body));
  } catch (e) { handleError(res, e); }
});

// ---------------- Active session ----------------

router.get('/active', async (req, res) => {
  res.json(await store.getActive());
});

router.post('/active/start', async (req, res) => {
  try {
    res.status(201).json(await store.startSession(req.body));
  } catch (e) { handleError(res, e); }
});

router.post('/active/pause', async (req, res) => {
  try {
    res.json(await store.pauseActive());
  } catch (e) { handleError(res, e); }
});

router.post('/active/resume', async (req, res) => {
  try {
    res.json(await store.resumeActive());
  } catch (e) { handleError(res, e); }
});

router.post('/active/cancel', async (req, res) => {
  try {
    await store.cancelActive();
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
});

router.post('/active/finish', async (req, res) => {
  try {
    res.json(await store.finishActive());
  } catch (e) { handleError(res, e); }
});

// ---------------- Manual day logs ----------------

router.put('/daylog/:date', async (req, res) => {
  try {
    await store.setDayLog(req.params.date, req.body.status === undefined ? null : req.body.status);
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
});

// ---------------- Stats / heatmap ----------------

router.get('/stats', async (req, res) => {
  res.json(await store.getStats(req.query.year));
});

module.exports = router;
