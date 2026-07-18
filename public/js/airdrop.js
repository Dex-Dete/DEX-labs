// AirDrop: a small, self-contained module for the LAN file-share feature.
// It deliberately does NOT share code with app.js (Lesson Tracker) beyond
// the page shell (topbar/toast element already in index.html) - this
// keeps the two features easy to reason about independently, even though
// they live on the same site/port.
(() => {
  const toastEl = document.getElementById('toast');
  let countdownTimer = null;
  let autoRefreshTimer = null;
  let currentFiles = [];

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
    if (m >= 1) return `${m}m ${s}s left`;
    return `${s}s left`;
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

  function renderList() {
    const wrap = document.getElementById('airdrop-list-wrap');
    if (!wrap) return; // navigated away
    if (currentFiles.length === 0) {
      wrap.innerHTML = `<div class="empty-state">No files yet. Drop one above and it'll show up here for everyone on this WiFi.</div>`;
      return;
    }
    wrap.innerHTML = `<div class="airdrop-list">${currentFiles.map((f) => `
      <div class="airdrop-item" data-id="${f.id}" data-expires="${f.expiresAt}">
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

  function render() {
    stopTimers();
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = '<span>AirDrop</span>';
    const view = document.getElementById('view');
    view.innerHTML = `
      <h1 class="page-title">AirDrop</h1>
      <div class="airdrop-page-sub">Drop a file here and grab it from any phone or PC on this same WiFi. Files delete themselves after 1 hour.</div>
      <div class="panel">
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
      </div>
      <div id="airdrop-list-wrap"><div class="empty-state">Loading…</div></div>
      <div class="airdrop-hint-banner">Everyone on this WiFi sees the same drop - don't put anything here you don't want others on the network to grab.</div>
    `;

    loadFiles();
    countdownTimer = setInterval(tickCountdowns, 1000);
    autoRefreshTimer = setInterval(loadFiles, 15000);

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

  window.Airdrop = { render };
})();
