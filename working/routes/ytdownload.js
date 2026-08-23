// YouTube Downloader - its own route file, own storage file
// (lib/ytdownload-store.js), own data file (data/ytdownload.json), own
// downloads folder (downloads-youtube/). Zero imports from/into AirDrop,
// Lesson Tracker, Daily Schedule, or Timers - same isolation every other
// subsystem in this project follows.
const express = require('express');
const fs = require('fs');
const path = require('path');

const store = require('../lib/ytdownload-store');

const router = express.Router();

// Lets the frontend show "setting up tools…" vs a ready state without
// triggering a setup attempt itself.
router.get('/status', (req, res) => {
  const ytdlpPath = store.resolveYtdlp();
  const ffmpeg = store.resolveFfmpeg();
  res.json({
    ready: !!ytdlpPath && !!ffmpeg,
    ytdlpReady: !!ytdlpPath,
    ffmpegReady: !!ffmpeg,
    setup: store.getSetupState(),
  });
});

// Kicks off (or re-attempts) the one-time binary setup. Idempotent -
// if setup already succeeded this just confirms readiness quickly.
router.post('/setup', async (req, res) => {
  try {
    await store.ensureTools(true);
    res.json({ ok: true, setup: store.getSetupState() });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message, setup: store.getSetupState() });
  }
});

router.post('/lookup', async (req, res) => {
  const url = (req.body && req.body.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Paste a YouTube video link first.' });
  try {
    const info = await store.lookupVideo(url);
    res.json(info);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

router.post('/jobs', async (req, res) => {
  const { videoId, title, thumbnail, formatSelector, needsMerge, ext } = req.body || {};
  if (!videoId || !formatSelector) {
    return res.status(400).json({ error: 'Missing video or format selection - try looking the video up again.' });
  }
  try {
    const job = await store.startJob({ videoId, title, thumbnail, formatSelector, needsMerge: !!needsMerge, ext });
    res.status(201).json({ id: job.id });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not start the download.' });
  }
});

router.get('/jobs', async (req, res) => {
  const jobs = await store.listJobs();
  res.json(jobs.map(publicJob));
});

router.get('/jobs/:id', async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'That download was not found.' });
  res.json(publicJob(job));
});

router.get('/jobs/:id/file', async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || job.status !== 'done' || !job.outputFile) {
    return res.status(404).send('This file is not ready or was removed.');
  }
  const filePath = path.join(store.DOWNLOADS_DIR, job.outputFile);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing on disk.');
  const downloadName = `${sanitizeFilename(job.title || 'video')}.${job.ext || 'mp4'}`;
  res.download(filePath, downloadName);
});

router.delete('/jobs/:id', async (req, res) => {
  await store.removeJob(req.params.id);
  res.json({ ok: true });
});

router.post('/jobs/:id/cancel', async (req, res) => {
  const ok = await store.cancelJob(req.params.id);
  res.json({ ok });
});

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 150);
}

// Never send internal file paths back to the browser.
function publicJob(job) {
  const { id, videoId, title, thumbnail, status, percent, phase, speedText, etaText, error, ext, finalSizeBytes, createdAt, finishedAt } = job;
  return { id, videoId, title, thumbnail, status, percent, phase, speedText, etaText, error, ext, finalSizeBytes, createdAt, finishedAt };
}

module.exports = router;
