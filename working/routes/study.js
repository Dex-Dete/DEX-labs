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

// v1.2.0: manually-picked, permanently-saved pie/bar chart color. Empty
// string resets to the automatic color.
router.put('/subjects/:id/color', async (req, res) => {
  try {
    res.json(await store.setSubjectColor(req.params.id, req.body.color));
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

// ---------------- Rec: recorded-lecture timer (v1.2.1) ----------------
// Mirrors the Study active-session routes above exactly (same shape,
// /rec/active/... instead of /active/...) - Rec's endpoints live in this
// same router/mount (/api/study) rather than a new subsystem/router
// file, since it's "part of Study" (same subjects list), not an
// unrelated concern. Backed by lib/study-store.js's separate
// recSessions/activeRecSession fields - see that file's header comment.

router.get('/rec/active', async (req, res) => {
  res.json(await store.getRecActive());
});

router.post('/rec/active/start', async (req, res) => {
  try {
    res.status(201).json(await store.startRecSession(req.body));
  } catch (e) { handleError(res, e); }
});

router.post('/rec/active/pause', async (req, res) => {
  try {
    res.json(await store.pauseRecActive());
  } catch (e) { handleError(res, e); }
});

router.post('/rec/active/resume', async (req, res) => {
  try {
    res.json(await store.resumeRecActive());
  } catch (e) { handleError(res, e); }
});

router.post('/rec/active/cancel', async (req, res) => {
  try {
    await store.cancelRecActive();
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
});

router.post('/rec/active/finish', async (req, res) => {
  try {
    res.json(await store.finishRecActive());
  } catch (e) { handleError(res, e); }
});

// ---------------- Manual Rec entry (v1.3.6) ----------------

router.post('/rec/manual', async (req, res) => {
  try {
    res.status(201).json(await store.addManualRecSession(req.body));
  } catch (e) { handleError(res, e); }
});

// ---------------- Paper: past-paper timer (v1.3.7) ----------------
// Exactly mirrors the /rec/active routes above (same shape, /paper/...)
// - Paper is a third kind of tracked time alongside Study and Rec,
// sharing the same subjects list, backed by lib/study-store.js's
// separate paperSessions/activePaperSession fields.

router.get('/paper/active', async (req, res) => {
  res.json(await store.getPaperActive());
});

router.post('/paper/active/start', async (req, res) => {
  try {
    res.status(201).json(await store.startPaperSession(req.body));
  } catch (e) { handleError(res, e); }
});

router.post('/paper/active/pause', async (req, res) => {
  try {
    res.json(await store.pausePaperActive());
  } catch (e) { handleError(res, e); }
});

router.post('/paper/active/resume', async (req, res) => {
  try {
    res.json(await store.resumePaperActive());
  } catch (e) { handleError(res, e); }
});

router.post('/paper/active/cancel', async (req, res) => {
  try {
    await store.cancelPaperActive();
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
});

router.post('/paper/active/finish', async (req, res) => {
  try {
    res.json(await store.finishPaperActive());
  } catch (e) { handleError(res, e); }
});

// ---------------- Manual Paper entry (v1.3.7) ----------------

router.post('/paper/manual', async (req, res) => {
  try {
    res.status(201).json(await store.addManualPaperSession(req.body));
  } catch (e) { handleError(res, e); }
});

// ---------------- Stats / heatmap ----------------

router.get('/stats', async (req, res) => {
  res.json(await store.getStats(req.query.year));
});

// v1.3.3: same subject-totals breakdown as /stats above, but scoped to
// exactly one calendar day - powers the Stats tab's "Today" sub-view
// and the Calendar tab's per-day panel (see lib/study-store.js's
// getDayStats() header comment).
router.get('/stats/day/:date', async (req, res) => {
  try {
    res.json(await store.getDayStats(req.params.date));
  } catch (e) { handleError(res, e); }
});

module.exports = router;
