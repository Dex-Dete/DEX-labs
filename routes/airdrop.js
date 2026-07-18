// AirDrop-style LAN file share. Anyone on the same WiFi can drop a file
// in and grab it from any other device for 1 hour, then it's deleted
// automatically. Intentionally has nothing to do with the Lesson Tracker
// data model - it's a separate little tool that happens to live on the
// same site/port.
//
// Storage is capped as a SESSION TOTAL (30GB combined across everything
// currently sitting in AirDrop), not per-file - a single file can be as
// large as the whole cap if nothing else is stored at the moment.
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const store = require('../lib/airdrop-store');

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, store.getFilesDir()),
  filename: (req, file, cb) => {
    const safe = sanitizeFilename(file.originalname);
    const stored = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
    cb(null, stored);
  },
});
// multer's own `limits.fileSize` has to be a fixed number (no function
// form), so it can't track the user-configurable cap directly. Give it a
// generous 200GB sanity ceiling just to stop truly runaway uploads, and
// enforce the REAL (configurable, v1.0.5) cap manually below, after
// multer has streamed the file - same pattern as the existing combined-
// total check, just also covering the single-file case now that the cap
// isn't a fixed constant multer can be told about upfront.
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 * 1024 } });

const router = express.Router();

router.get('/files', async (req, res) => {
  const files = await store.listActive();
  const now = Date.now();
  const usedBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
  res.json({
    files: files.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      size: f.size,
      uploadedAt: f.uploadedAt,
      expiresAt: f.expiresAt,
      msRemaining: Math.max(0, f.expiresAt - now),
    })),
    usedBytes,
    capBytes: store.getCapBytes(),
  });
});

router.post('/upload', (req, res) => {
  upload.array('files', 20)(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `That file is larger than AirDrop's absolute sanity limit (200GB).` });
      }
      console.error(err);
      return res.status(500).json({ error: 'Upload failed' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No file received' });
    }

    // Enforce the combined session cap (v1.0.5: user-configurable via
    // Settings, default 30GB - see config-store.js/airdrop-store.js).
    // Multer has already written these files to disk by this point
    // (streaming upload), so if we're over budget we delete what was
    // just written and reject the request - wastes a bit of disk I/O on
    // an oversized attempt, but keeps the accounting simple and correct.
    const capBytes = store.getCapBytes();
    const incomingBytes = req.files.reduce((sum, f) => sum + f.size, 0);
    const existingBytes = await store.getTotalActiveBytes();
    if (existingBytes + incomingBytes > capBytes) {
      for (const f of req.files) {
        try { fs.unlinkSync(f.path); } catch (e) { /* already gone */ }
      }
      const remaining = Math.max(0, capBytes - existingBytes);
      const fmtGB = (b) => (b / 1024 / 1024 / 1024).toFixed(1);
      return res.status(400).json({
        error: `AirDrop is full for now - ${fmtGB(existingBytes)}GB of ${fmtGB(capBytes)}GB used, only ${fmtGB(remaining)}GB free. Wait for something to expire (1 hour) or delete a file, then try again. (You can raise this cap in Settings.)`,
      });
    }

    const now = Date.now();
    const entries = req.files.map((f) => ({
      id: store.genId(),
      originalName: f.originalname,
      storedName: f.filename,
      size: f.size,
      uploadedAt: new Date(now).toISOString(),
      expiresAt: now + store.TTL_MS,
    }));
    await store.addFiles(entries);
    res.status(201).json({ added: entries });
  });
});

router.get('/files/:id/download', async (req, res) => {
  const file = await store.getById(req.params.id);
  if (!file) return res.status(404).send('This file has expired or was removed.');
  const filePath = path.join(store.getFilesDir(), file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing on disk');
  res.download(filePath, file.originalName);
});

router.delete('/files/:id', async (req, res) => {
  await store.removeById(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
