// To-Do list routes - v1.4.0. Own router file, mounted at /api/todos in
// server.js, same "one router per subsystem" pattern as routes/events.js
// / routes/study.js. Backed by lib/todos-store.js (data/todos.json).
//
// Endpoints (all deliberately minimal - the brief demanded easy add and
// delete):
//   GET    /api/todos        full list (pending first, then done)
//   GET    /api/todos/pending
//                            pending-only list (Standby Mode / calendar)
//   POST   /api/todos        { text, dueDate? } -> add a to-do
//   PATCH  /api/todos/:id    { text?, dueDate?, done? } -> tick/un-tick
//                            or edit / re-schedule
//   DELETE /api/todos/:id    remove a to-do
const express = require('express');
const store = require('../lib/todos-store');

const router = express.Router();

function handleError(res, err, fallbackStatus = 400) {
  res.status(fallbackStatus).json({ error: (err && err.message) || 'Something went wrong' });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Empty string and undefined both mean "no date"; anything else must be
// a real YYYY-MM-DD.
function cleanDate(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) throw new Error('dueDate must be a date like 2026-08-10 (or empty for no date).');
  return raw;
}

function cleanText(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('To-do text is required.');
  return raw.trim().slice(0, 500);
}

router.get('/', (req, res) => {
  res.json({ todos: store.list() });
});

router.get('/pending', (req, res) => {
  res.json({ todos: store.listPending() });
});

router.post('/', async (req, res) => {
  try {
    const text = cleanText(req.body && req.body.text);
    const dueDate = cleanDate(req.body && req.body.dueDate);
    res.status(201).json(await store.add({ text, dueDate }));
  } catch (e) { handleError(res, e); }
});

router.patch('/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};
    if (body.text !== undefined) patch.text = cleanText(body.text);
    if (body.dueDate !== undefined) patch.dueDate = cleanDate(body.dueDate);
    if (body.done !== undefined) patch.done = !!body.done;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Send text, dueDate, or done to update.' });
    const todo = await store.update(req.params.id, patch);
    if (!todo) return res.status(404).json({ error: 'To-do not found.' });
    res.json(todo);
  } catch (e) { handleError(res, e); }
});

router.delete('/:id', async (req, res) => {
  try {
    const removed = await store.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'To-do not found.' });
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
});

module.exports = router;
