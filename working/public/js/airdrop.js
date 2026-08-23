// AirDrop: a small, self-contained module for the LAN file-share feature.
// It deliberately does NOT share code with app.js (Lesson Tracker) beyond
// the page shell (topbar/toast element already in index.html) - this
// keeps the two features easy to reason about independently, even though
// they live on the same site/port.
//
// v1.5.0 additions, all in this file:
//   - "Clipboard" clips: paste a text on your phone and it appears here
//     for 30 minutes, newest first, BELOW the file list. Copy it off on
//     the PC with one tap (or it's already auto-copied to the PC's
//     clipboard - see routes/airdrop.js).
//   - Two page styles, picked in Settings > AirDrop page style:
//     'classic' (the original layout, unchanged) and 'apple' (a
//     macOS-AirDrop-style window: device circles + incoming clip bubbles
//     + composer). Same backend data either way.
(() => {
  const toastEl = document.getElementById('toast');
  let countdownTimer = null;
  let autoRefreshTimer = null;
  let currentFiles = [];
  let currentClips = [];
  let pageStyle = 'classic';
  let autoCopyEnabled = true;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { bytes /= 1024; i++; } while (bytes >= 1024 && i < units.length - 1);
    return bytes.toFixed(bytes >= 10 ? 0 : 1) + ' ' + units[i];
  }

  function extBadge(name) {
    const ext = (name.split('.').pop() || '?').toUpperCase().slice(0, 4);
    return ext;
  }

  function fmtRemaining(ms) {
    if (ms <= 0) return 'expired';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m >= 1) return `${m}m ${s}s`;
    return `${s}s`;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong');
    return data;
  }

  function uploadFiles(files, onProgress) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/airdrop/upload');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          let msg = 'Upload failed';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch (e) {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed - check your connection'));
      xhr.send(form);
    });
  }

  function stopTimers() {
    if (countdownTimer) clearInterval(countdownTimer);
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    countdownTimer = null;
    autoRefreshTimer = null;
  }

  // ---------------- Clipboard clips (v1.5.0) ----------------

  // Best guess at "which device am I" for the clip's source label -
  // cosmetic only, the server stores whatever string arrives.
  function myDeviceLabel() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'PC';
    return 'Device';
  }

  function clipComposerHtml() {
    return `
      <div class="airdrop-clip-composer">
        <textarea id="airdrop-clip-text" maxlength="2000" rows="2" placeholder="Paste text here on your phone, then send - it lands on the PC for 30 minutes…"></textarea>
        <div class="airdrop-clip-composer-row">
          <button class="btn secondary" id="airdrop-clip-read">Paste from this device</button>
          <button class="btn" id="airdrop-clip-send">Send to DEX Labs</button>
        </div>
      </div>
    `;
  }

  function clipsSectionHtml() {
    const list = currentClips.length
      ? currentClips.map((c) => `
          <div class="airdrop-clip${c.isNewest ? ' newest' : ''}" data-id="${c.id}" data-expires="${c.expiresAt}">
            <div class="airdrop-clip-head">
              <span class="airdrop-clip-source">📱 ${escapeHtml(c.source)}</span>
              <span class="airdrop-clip-time">${fmtRemaining(c.msRemaining)} left</span>
            </div>
            <div class="airdrop-clip-text">${escapeHtml(c.text)}</div>
            <div class="airdrop-clip-actions">
              <button class="airdrop-clip-copy" data-id="${c.id}">Copy</button>
              <button class="airdrop-clip-del" data-id="${c.id}" title="Delete now">✕</button>
            </div>
          </div>
        `).join('')
      : '<div class="empty-state">No clips yet. Paste text on your phone and send it here - it shows up on the PC for 30 minutes.</div>';
    return `
      <div class="airdrop-clips-panel">
        <div class="airdrop-clips-title">Clipboard <span class="hint">(text pasted from a phone, auto-deletes after 30 minutes)</span></div>
        ${clipComposerHtml()}
        ${autoCopyEnabled ? '<div class="airdrop-clip-autocopy-hint">Newest clip is automatically copied to the PC running DEX Labs - just paste on the PC.</div>' : ''}
        <div class="airdrop-clips-list">${list}</div>
      </div>
    `;
  }

  function renderClips() {
    const wrap = document.getElementById('airdrop-clips-wrap');
    if (!wrap) return; // navigated away
    if (pageStyle === 'apple') {
      renderAppleClips();
      return;
    }
    wrap.innerHTML = clipsSectionHtml();
    wireClipUi();
  }

  function wireClipUi() {
    const readBtn = document.getElementById('airdrop-clip-read');
    const sendBtn = document.getElementById('airdrop-clip-send');
    const textEl = document.getElementById('airdrop-clip-text');
    if (sendBtn) {
      sendBtn.addEventListener('click', sendClip);
      textEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendClip();
      });
    }
    if (readBtn) readBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const t = await navigator.clipboard.readText();
          if (textEl) textEl.value = t;
          else showToast('Nothing to paste from this device');
        } else {
          showToast('Your browser does not allow reading the clipboard - paste manually into the box.');
        }
      } catch (e) {
        showToast('Clipboard read blocked by the browser - paste manually instead.');
      }
    });
    const wrap = document.getElementById('airdrop-clips-wrap');
    if (wrap) {
      wrap.querySelectorAll('.airdrop-clip-copy').forEach((btn) => {
        btn.addEventListener('click', () => copyClipText(btn.dataset.id));
      });
      wrap.querySelectorAll('.airdrop-clip-del').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await api(`/api/airdrop/clips/${btn.dataset.id}`, { method: 'DELETE' });
          loadClips();
        });
      });
    }
  }

  async function sendClip() {
    const textEl = document.getElementById('airdrop-clip-text');
    if (!textEl) return;
    const text = textEl.value.trim();
    if (!text) { showToast('Paste or type something first.'); return; }
    try {
      await api('/api/airdrop/clips', { method: 'POST', body: { text, source: myDeviceLabel() } });
      textEl.value = '';
      showToast('Clip sent to DEX Labs ✅');
      await loadClips();
    } catch (e) { showToast(e.message); }
  }

  async function copyClipText(id) {
    const clip = currentClips.find((c) => c.id === id);
    if (!clip) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(clip.text);
        showToast('Copied to this device ✅');
      } else {
        const ta = document.createElement('textarea');
        ta.value = clip.text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast('Copied to this device ✅');
      }
    } catch (e) {
      showToast('Could not copy - select the text manually.');
    }
  }

  async function loadClips() {
    try {
      const data = await api('/api/airdrop/clips');
      currentClips = (data.clips || []).map((c, i) => ({ ...c, isNewest: i === 0 }));
      renderClips();
    } catch (e) { /* not critical - clips just don't update */ }
  }

  function tickClipCountdowns() {
    const wrap = document.getElementById('airdrop-clips-wrap');
    if (!wrap) return;
    let anyExpired = false;
    wrap.querySelectorAll('.airdrop-clip').forEach((row) => {
      const expiresAt = Number(row.dataset.expires);
      const remaining = expiresAt - Date.now();
      const el = row.querySelector('.airdrop-clip-time');
      if (el) el.textContent = `${fmtRemaining(remaining)} left`;
      if (remaining <= 0) anyExpired = true;
    });
    if (anyExpired) loadClips();
  }

  // ---------------- Apple-style AirDrop window (v1.5.0) ----------------
  // A macOS-AirDrop look over the SAME backend data: a "device" row
  // (the PC running DEX Labs as the receiving device), incoming clips
  // as chat-style bubbles from the phone, and the file dropzone/list
  // inside a Mac-like share window. Purely presentation - files and
  // clips are identical to classic mode.
  function renderAppleClips() {
    const wrap = document.getElementById('airdrop-clips-wrap');
    if (!wrap) return;
    const bubbles = currentClips.length
      ? currentClips.map((c) => `
          <div class="apple-clip-bubble${c.isNewest ? ' newest' : ''}" data-id="${c.id}" data-expires="${c.expiresAt}">
            <div class="apple-clip-bubble-head">
              <span class="apple-clip-sender">${escapeHtml(c.source)}</span>
              <span class="apple-clip-time">${fmtRemaining(c.msRemaining)}</span>
            </div>
            <div class="apple-clip-text">${escapeHtml(c.text)}</div>
            <div class="apple-clip-actions">
              <button class="apple-clip-copy" data-id="${c.id}">Copy</button>
              <button class="apple-clip-del" data-id="${c.id}" title="Delete now">✕</button>
            </div>
          </div>
        `).join('')
      : '<div class="apple-clip-empty">Nothing received yet. Paste text on your phone below and it flies over here.</div>';
    wrap.innerHTML = `
      <div class="apple-clips-panel">
        <div class="apple-clips-title">Received</div>
        <div class="apple-clips-bubbles">${bubbles}</div>
        <div class="apple-composer">
          <textarea id="airdrop-clip-text" maxlength="2000" rows="2" placeholder="Paste text here and send - like AirDrop to your PC…"></textarea>
          <div class="apple-composer-row">
            <button class="btn secondary" id="airdrop-clip-read">Paste from this device</button>
            <button class="btn apple-send" id="airdrop-clip-send">Send</button>
          </div>
        </div>
        ${autoCopyEnabled ? '<div class="airdrop-clip-autocopy-hint">Newest clip is automatically copied to the PC running DEX Labs - just paste on the PC.</div>' : ''}
      </div>
    `;
    wireClipUi();
  }

  // ---------------- Files ----------------

  function renderList() {
    const wrap = document.getElementById('airdrop-list-wrap');
    if (!wrap) return; // navigated away
    if (currentFiles.length === 0) {
      wrap.innerHTML = `<div class="empty-state">${pageStyle === 'apple' ? 'No files received yet - send a file from your phone or drop one above.' : 'No files yet. Drop one above and it\'ll show up here for everyone on this WiFi.'}</div>`;
      return;
    }
    const cls = pageStyle === 'apple' ? ' airdrop-item-apple' : '';
    wrap.innerHTML = `<div class="airdrop-list">${currentFiles.map((f) => `
      <div class="airdrop-item${cls}" data-id="${f.id}" data-expires="${f.expiresAt}">
        <div class="ficon">${escapeHtml(extBadge(f.originalName))}</div>
        <div class="info">
          <div class="name">${escapeHtml(f.originalName)}</div>
          <div class="meta-row">
            <span>${fmtSize(f.size)}</span>
            <span class="expiry">${fmtRemaining(f.msRemaining)}</span>
          </div>
        </div>
        <a class="dl" href="/api/airdrop/files/${f.id}/download" download>Download</a>
        <button class="del-btn" title="Delete now" data-id="${f.id}">✕</button>
      </div>
    `).join('')}</div>`;

    wrap.querySelectorAll('.del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this file now?')) return;
        await api(`/api/airdrop/files/${btn.dataset.id}`, { method: 'DELETE' });
        loadFiles();
      });
    });
  }

  function tickCountdowns() {
    const wrap = document.getElementById('airdrop-list-wrap');
    if (!wrap) { stopTimers(); return; }
    let anyExpired = false;
    wrap.querySelectorAll('.airdrop-item').forEach((row) => {
      const expiresAt = Number(row.dataset.expires);
      const remaining = expiresAt - Date.now();
      const el = row.querySelector('.expiry');
      if (!el) return;
      el.textContent = fmtRemaining(remaining);
      el.classList.toggle('soon', remaining > 0 && remaining < 5 * 60 * 1000);
      if (remaining <= 0) anyExpired = true;
    });
    if (anyExpired) loadFiles();
  }

  async function loadFiles() {
    try {
      const info = await api('/api/airdrop/files');
      currentFiles = info.files;
      renderUsage(info.usedBytes, info.capBytes);
      renderList();
    } catch (e) {
      const wrap = document.getElementById('airdrop-list-wrap');
      if (wrap) wrap.innerHTML = `<div class="empty-state">Could not load files: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderUsage(usedBytes, capBytes) {
    const bar = document.getElementById('airdrop-usage-bar');
    const label = document.getElementById('airdrop-usage-label');
    if (!bar || !label) return;
    const pct = capBytes ? Math.min(100, (usedBytes / capBytes) * 100) : 0;
    bar.style.width = `${pct}%`;
    bar.classList.toggle('full', pct > 90);
    label.textContent = `${fmtSize(usedBytes)} of ${fmtSize(capBytes)} used`;
  }

  function dropzoneHtml() {
    return `
      <div class="airdrop-dropzone" id="airdrop-dropzone">
        Tap to choose files, or drag &amp; drop here<br/>
        <span class="hint">Any file type - auto-deletes in 1 hour. Shared 30GB total across everyone on this WiFi.</span>
      </div>
      <input type="file" id="airdrop-file-input" multiple style="display:none" />
      <div id="airdrop-upload-status"></div>
      <div class="airdrop-usage-wrap">
        <div class="airdrop-usage-track"><div class="airdrop-usage-bar" id="airdrop-usage-bar"></div></div>
        <div class="airdrop-usage-label" id="airdrop-usage-label">Loading…</div>
      </div>
    `;
  }

  function wireDropzone() {
    const dropzone = document.getElementById('airdrop-dropzone');
    const fileInput = document.getElementById('airdrop-file-input');
    const statusEl = document.getElementById('airdrop-upload-status');

    dropzone.addEventListener('click', () => fileInput.click());
    ['dragover', 'dragenter'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); dropzone.classList.add('drag');
    }));
    ['dragleave', 'dragend', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => {
      dropzone.classList.remove('drag');
    }));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length) startUpload(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) startUpload(fileInput.files);
    });

    function startUpload(fileList) {
      const files = Array.from(fileList);
      const totalSize = files.reduce((a, f) => a + f.size, 0);
      statusEl.innerHTML = `
        <div class="upload-row">Uploading ${files.length} file${files.length > 1 ? 's' : ''} (${fmtSize(totalSize)})…</div>
        <div class="progress-wrap"><div class="progress-bar" id="airdrop-pbar"></div></div>
      `;
      const pbar = document.getElementById('airdrop-pbar');
      uploadFiles(files, (frac) => { pbar.style.width = `${Math.round(frac * 100)}%`; })
        .then(() => {
          statusEl.innerHTML = '';
          showToast('Dropped');
          fileInput.value = '';
          loadFiles();
        })
        .catch((e) => {
          statusEl.innerHTML = `<div class="upload-row">${escapeHtml(e.message)}</div>`;
        });
    }
  }

  // ---------------- Entry point ----------------

  async function render() {
    stopTimers();
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = '<span>AirDrop</span>';
    const view = document.getElementById('view');

    // v1.5.0: page style + auto-copy flag come from Settings (GET
    // /api/settings), so the toggle there changes this page on next
    // visit without a restart.
    try {
      const s = await api('/api/settings');
      pageStyle = s.airdropStyle === 'apple' ? 'apple' : 'classic';
      autoCopyEnabled = s.airdropAutoCopy !== false;
    } catch (e) { /* keep defaults */ }

    if (pageStyle === 'apple') {
      view.innerHTML = `
        <div class="apple-airdrop-root">
          <div class="apple-airdrop-header">
            <div class="apple-airdrop-radar">
              <div class="apple-device-circle">
                <div class="apple-device-icon">🖥️</div>
                <div class="apple-device-name">This PC</div>
                <div class="apple-device-sub">DEX Labs</div>
              </div>
            </div>
            <div class="apple-airdrop-caption">Send from your phone below - files and text land on this PC. Auto-deletes: files 1 hour, text 30 minutes.</div>
          </div>
          <div id="airdrop-clips-wrap"><div class="empty-state">Loading…</div></div>
          <div class="apple-share-window">
            <div class="apple-share-title">Files</div>
            <div class="apple-dropzone-area">${dropzoneHtml()}</div>
            <div id="airdrop-list-wrap"><div class="empty-state">Loading…</div></div>
          </div>
        </div>
      `;
    } else {
      view.innerHTML = `
        <h1 class="page-title">AirDrop</h1>
        <div class="airdrop-page-sub">Drop a file here and grab it from any phone or PC on this same WiFi. Files delete themselves after 1 hour.</div>
        <div class="panel">
          ${dropzoneHtml()}
        </div>
        <div id="airdrop-list-wrap"><div class="empty-state">Loading…</div></div>
        <div id="airdrop-clips-wrap"><div class="empty-state">Loading…</div></div>
        <div class="airdrop-hint-banner">Everyone on this WiFi sees the same drop - don't put anything here you don't want others on the network to grab.</div>
      `;
    }

    wireDropzone();
    loadFiles();
    loadClips();
    countdownTimer = setInterval(() => { tickCountdowns(); tickClipCountdowns(); }, 1000);
    autoRefreshTimer = setInterval(() => { loadFiles(); loadClips(); }, 15000);
  }

  window.Airdrop = { render, cleanup: stopTimers };
  window.DexSubsystems = window.DexSubsystems || {};
  window.DexSubsystems['airdrop'] = { render, cleanup: stopTimers };
})();
