// All Lesson Tracker endpoints: subjects, YouTube lessons, and tute files.
// This is its own module so it stays cleanly separate from the AirDrop
// feature (routes/airdrop.js) even though both are mounted on the same
// server/port.
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const db = require('../db');
const yt = require('../lib/youtube');

// "Grade" used to be a hardcoded '10'/'11' choice. It's now a renameable,
// addable per-subject "category" list (still called `grade` in the data
// model/URLs for backward compatibility with existing lessons, but the
// display name is fully user-editable). Any subject saved before this
// feature existed gets these two default categories added automatically
// the first time it's touched, so nothing breaks.
const DEFAULT_CATEGORIES = [
  { id: '10', name: 'Grade 10' },
  { id: '11', name: 'Grade 11' },
];

function ensureCategories(subject) {
  if (!Array.isArray(subject.categories) || subject.categories.length === 0) {
    subject.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  }
  return subject.categories;
}

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200);
}

function findSubject(data, id) {
  return data.subjects.find((s) => s.id === id);
}

module.exports = function createLessonsRouter(uploadRoot) {
  const router = express.Router();

  if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

  // One-time migration at startup: make sure every existing subject has a
  // `categories` list, so old data saved before this feature existed
  // keeps working exactly as before (Grade 10 / Grade 11).
  db.update((data) => {
    let changed = false;
    for (const subject of data.subjects) {
      if (!Array.isArray(subject.categories) || subject.categories.length === 0) {
        subject.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
        changed = true;
      }
    }
    return changed;
  }).catch((e) => console.error('Category migration failed:', e));

  function subjectUploadDir(subjectId) {
    const dir = path.join(uploadRoot, subjectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ---------- subjects ----------
  router.get('/subjects', (req, res) => {
    const data = db.read();
    data.subjects.forEach(ensureCategories);
    res.json(data.subjects);
  });

  router.post('/subjects', async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Subject name is required' });

    const result = await db.update((data) => {
      let id = db.slugify(name);
      if (findSubject(data, id)) id = db.genId('subj');
      const subject = { id, name, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })) };
      data.subjects.push(subject);
      return subject;
    });
    res.status(201).json(result);
  });

  router.delete('/subjects/:id', async (req, res) => {
    await db.update((data) => {
      data.subjects = data.subjects.filter((s) => s.id !== req.params.id);
      data.lessons = data.lessons.filter((l) => l.subjectId !== req.params.id);
      data.tutes = data.tutes.filter((t) => t.subjectId !== req.params.id);
    });
    res.json({ ok: true });
  });

  // ---------- categories (formerly hardcoded "grade") ----------
  router.post('/subjects/:id/categories', async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    const data = db.read();
    const subject = findSubject(data, req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    const category = await db.update((d) => {
      const s = findSubject(d, req.params.id);
      ensureCategories(s);
      let id = db.slugify(name);
      if (s.categories.some((c) => c.id === id)) id = db.genId('cat');
      const cat = { id, name };
      s.categories.push(cat);
      return cat;
    });
    res.status(201).json(category);
  });

  router.patch('/subjects/:id/categories/:catId', async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    const data = db.read();
    const subject = findSubject(data, req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    const result = await db.update((d) => {
      const s = findSubject(d, req.params.id);
      ensureCategories(s);
      const cat = s.categories.find((c) => c.id === req.params.catId);
      if (!cat) return null;
      cat.name = name;
      return cat;
    });
    if (!result) return res.status(404).json({ error: 'Category not found' });
    res.json(result);
  });

  router.delete('/subjects/:id/categories/:catId', async (req, res) => {
    const data = db.read();
    const subject = findSubject(data, req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    ensureCategories(subject);
    if (subject.categories.length <= 1) {
      return res.status(400).json({ error: 'A subject needs at least one category - add another before deleting this one.' });
    }
    const lessonCount = data.lessons.filter((l) => l.subjectId === req.params.id && l.grade === req.params.catId).length;
    const tuteCount = 0; // tutes aren't split by category
    if (lessonCount > 0) {
      return res.status(400).json({ error: `This category has ${lessonCount} lesson${lessonCount > 1 ? 's' : ''} in it. Remove or move them first.` });
    }
    await db.update((d) => {
      const s = findSubject(d, req.params.id);
      s.categories = s.categories.filter((c) => c.id !== req.params.catId);
    });
    res.json({ ok: true });
  });

  // ---------- lessons (YouTube) ----------
  router.get('/subjects/:id/lessons', (req, res) => {
    const data = db.read();
    const grade = req.query.grade;
    let lessons = data.lessons.filter((l) => l.subjectId === req.params.id);
    if (grade) lessons = lessons.filter((l) => l.grade === grade);
    lessons.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    // Older lessons saved before the "watched" feature existed won't have
    // the field - treat that as "not watched" rather than leaving it undefined.
    lessons = lessons.map((l) => ({ watched: false, ...l }));
    res.json(lessons);
  });

  router.post('/subjects/:id/lessons', async (req, res) => {
    const grade = req.body.grade;
    const url = yt.sanitizeUrl(req.body.url);
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'A valid YouTube URL is required' });
    }

    const data = db.read();
    const subject = findSubject(data, req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    ensureCategories(subject);
    if (!subject.categories.some((c) => c.id === grade)) {
      return res.status(400).json({ error: 'Unknown category - refresh the page and try again.' });
    }

    // Last-resort path: save the link as-is (best-effort title/thumbnail,
    // never throws) so that as long as what was pasted is a real URL, the
    // "Add" button always actually adds *something* rather than the user
    // hitting a wall. Used both for plain single-video adds, and as the
    // fallback if playlist handling (or anything else below) fails.
    async function addRawLinkLesson() {
      let meta;
      try {
        meta = await yt.fetchVideoMeta(url);
      } catch (e) {
        const videoId = yt.extractVideoId(url);
        meta = { videoId, title: url, thumbnail: yt.thumbnailFor(videoId) };
      }
      return db.update((d) => {
        const lesson = {
          id: db.genId('lsn'),
          subjectId: subject.id,
          grade,
          title: meta.title,
          url,
          videoId: meta.videoId,
          thumbnail: meta.thumbnail,
          playlistTitle: null,
          watched: false,
          addedAt: new Date().toISOString(),
        };
        d.lessons.push(lesson);
        return lesson;
      });
    }

    try {
      const added = [];
      let partial = false;
      let warning;

      if (yt.isPlaylistUrl(url)) {
        try {
          const playlist = await yt.fetchPlaylistItems(url);
          if (!playlist || playlist.items.length === 0) {
            throw new Error('YouTube returned that playlist with no videos, even after retrying.');
          }
          partial = !!playlist.partial;
          await db.update((d) => {
            for (const item of playlist.items) {
              const lesson = {
                id: db.genId('lsn'),
                subjectId: subject.id,
                grade,
                title: item.title,
                url: item.url,
                videoId: item.videoId,
                thumbnail: item.thumbnail,
                playlistTitle: playlist.playlistTitle,
                watched: false,
                addedAt: new Date().toISOString(),
              };
              d.lessons.push(lesson);
              added.push(lesson);
            }
          });
          if (partial) {
            warning = 'Only the most recent videos in this playlist could be read (YouTube limits this fallback method) - the rest were not added. Try again later for the full list.';
          }
        } catch (playlistErr) {
          console.error(`Playlist add failed for ${url}, falling back to a single link:`, (playlistErr && playlistErr.stack) || playlistErr);
          // The link might still point at one specific video (a normal
          // "watch?v=...&list=..." link) even though playlist handling
          // failed - fall back to adding just that video instead of
          // failing the whole request. Only give up completely if the
          // link is a playlist with no video of its own to fall back to.
          const videoId = yt.extractVideoId(url);
          if (videoId) {
            const lesson = await addRawLinkLesson();
            added.push(lesson);
            warning = `Couldn't read the full playlist (${playlistErr && playlistErr.friendly ? playlistErr.message : 'YouTube blocked or changed something'}), so only this one video was added instead.`;
          } else {
            throw playlistErr;
          }
        }
      } else {
        const lesson = await addRawLinkLesson();
        added.push(lesson);
      }

      res.status(201).json({ added, partial, warning });
    } catch (err) {
      console.error('Failed to add lesson:', (err && err.stack) || err);
      // Truly last resort - a bug or a disk/db problem got this far.
      // Still worth one more attempt to just save the raw link before
      // telling the user it failed outright.
      try {
        const lesson = await addRawLinkLesson();
        return res.status(201).json({
          added: [lesson],
          partial: false,
          warning: "Couldn't fetch this video's info right now, so it was added with just the link. Use \"Details\" later once things are working to fill in the title.",
        });
      } catch (fallbackErr) {
        console.error('Fail-safe raw-link add also failed:', (fallbackErr && fallbackErr.stack) || fallbackErr);
      }
      const message = err.friendly
        ? err.message
        : 'Could not process that YouTube link. Check the link and your internet connection.';
      res.status(500).json({ error: message });
    }
  });

  // Toggle / set the watched state of a lesson (used to blur out videos
  // you've already finished watching).
  router.patch('/lessons/:id/watched', async (req, res) => {
    const watched = !!req.body.watched;
    const data = db.read();
    const lesson = data.lessons.find((l) => l.id === req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    await db.update((d) => {
      const l = d.lessons.find((x) => x.id === req.params.id);
      if (l) l.watched = watched;
    });
    res.json({ ok: true, watched });
  });

  // On-demand full title + description - only fetched when someone
  // actually clicks "Details" on a lesson, not for every video up front.
  router.get('/lessons/:id/details', async (req, res) => {
    const data = db.read();
    const lesson = data.lessons.find((l) => l.id === req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    try {
      const details = await yt.fetchVideoDetails(lesson.videoId);
      res.json({
        title: details.title || lesson.title,
        description: details.description,
      });
    } catch (err) {
      const message = err.friendly ? err.message : 'Could not fetch details for this video right now.';
      res.status(500).json({ error: message });
    }
  });

  router.delete('/lessons/:id', async (req, res) => {
    await db.update((data) => {
      data.lessons = data.lessons.filter((l) => l.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  // ---------- tutes (files) ----------
  const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB per file
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, subjectUploadDir(req.params.id));
    },
    filename: (req, file, cb) => {
      const safe = sanitizeFilename(file.originalname);
      const stored = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      cb(null, stored);
    },
  });
  const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

  router.get('/subjects/:id/tutes', (req, res) => {
    const data = db.read();
    const tutes = data.tutes
      .filter((t) => t.subjectId === req.params.id)
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    res.json(tutes);
  });

  router.post('/subjects/:id/tutes', (req, res) => {
    const data = db.read();
    const subject = findSubject(data, req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    upload.array('files', 20)(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File is larger than the 5GB limit' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Upload failed' });
      }
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No file received' });
      }
      const added = await db.update((d) => {
        const entries = req.files.map((f) => ({
          id: db.genId('tute'),
          subjectId: subject.id,
          originalName: f.originalname,
          storedName: f.filename,
          size: f.size,
          addedAt: new Date().toISOString(),
        }));
        d.tutes.push(...entries);
        return entries;
      });
      res.status(201).json({ added });
    });
  });

  router.get('/tutes/:id/download', (req, res) => {
    const data = db.read();
    const tute = data.tutes.find((t) => t.id === req.params.id);
    if (!tute) return res.status(404).send('Not found');
    const filePath = path.join(uploadRoot, tute.subjectId, tute.storedName);
    if (!fs.existsSync(filePath)) return res.status(404).send('File missing on disk');
    res.download(filePath, tute.originalName);
  });

  router.delete('/tutes/:id', async (req, res) => {
    const data = db.read();
    const tute = data.tutes.find((t) => t.id === req.params.id);
    if (tute) {
      const filePath = path.join(uploadRoot, tute.subjectId, tute.storedName);
      try { fs.unlinkSync(filePath); } catch (e) { /* already gone */ }
    }
    await db.update((d) => {
      d.tutes = d.tutes.filter((t) => t.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  return router;
};
