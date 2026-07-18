// YouTube Downloader: a small, self-contained module for the video
// download feature. Deliberately does NOT share code with app.js or any
// other subsystem's JS module beyond the page shell already in
// index.html (topbar/toast/crumbs) - same isolation pattern as
// airdrop.js/schedule.js/timers.js, each with their own tiny copies of
// escapeHtml/showToast/api/fmtSize rather than a shared import.
(() => {
  const toastEl = document.getElementById('toast');
  let pollTimer = null;
  let historyTimer = null;
  let currentLookup = null; // { videoId, title, thumbnail, options }
  let selectedOptionId = null;

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

  function fmtSize(bytes) {
    if (bytes === null || bytes === undefined) return 'unknown size';
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { bytes /= 1024; i++; } while (bytes >= 1024 && i < units.length - 1);
    return bytes.toFixed(bytes >= 10 ? 0 : 1) + ' ' + units[i];
  }

  function fmtDuration(sec) {
    if (!sec && sec !== 0) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const mm = h ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function stopTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (historyTimer) clearInterval(historyTimer);
    if (setupPollTimer) clearInterval(setupPollTimer);
    pollTimer = null;
    historyTimer = null;
    setupPollTimer = null;
  }

  // ---------------- setup banner ----------------
  let setupPollTimer = null;

  async function refreshSetupBanner() {
    const banner = document.getElementById('ytdl-setup-banner');
    if (!banner) { if (setupPollTimer) clearInterval(setupPollTimer); return true; }
    try {
      const status = await api('/api/ytdownload/status');
      if (status.ready) {
        banner.style.display = 'none';
        if (setupPollTimer) { clearInterval(setupPollTimer); setupPollTimer = null; }
        return true;
      }
      banner.style.display = 'flex';
      const setup = status.setup || {};
      if (setup.status === 'error') {
        banner.classList.add('error');
        banner.innerHTML = `
          <div class="msg">Setup failed: ${escapeHtml(setup.message || 'Unknown error')}</div>
          <button class="btn" id="ytdl-setup-retry">Retry</button>
        `;
        document.getElementById('ytdl-setup-retry').addEventListener('click', () => {
          triggerSetup();
          if (!setupPollTimer) setupPollTimer = setInterval(refreshSetupBanner, 1000);
        });
        if (setupPollTimer) { clearInterval(setupPollTimer); setupPollTimer = null; }
      } else {
        banner.classList.remove('error');
        banner.innerHTML = `
          <span class="spinner"></span>
          <div class="msg">${escapeHtml(setup.message || 'Setting up yt-dlp and ffmpeg (one-time, first use only)…')}</div>
        `;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  let setupInFlight = false;
  async function triggerSetup() {
    if (setupInFlight) return;
    setupInFlight = true;
    try {
      await api('/api/ytdownload/setup', { method: 'POST' });
    } catch (e) {
      // banner already reflects the failure via the next status poll
    } finally {
      setupInFlight = false;
      refreshSetupBanner();
    }
  }

  async function startSetupFlow() {
    const ready = await refreshSetupBanner();
    if (ready) return;
    triggerSetup();
    setupPollTimer = setInterval(refreshSetupBanner, 1000);
  }

  // ---------------- lookup + quality selection ----------------
  async function doLookup() {
    const input = document.getElementById('ytdl-url-input');
    const url = input.value.trim();
    const errorBox = document.getElementById('ytdl-lookup-error');
    const resultWrap = document.getElementById('ytdl-result-wrap');
    errorBox.innerHTML = '';
    if (!url) return;
    const btn = document.getElementById('ytdl-lookup-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Looking up…`;
    resultWrap.innerHTML = '';
    try {
      const info = await api('/api/ytdownload/lookup', { method: 'POST', body: { url } });
      currentLookup = info;
      selectedOptionId = info.options.length ? info.options[0].id : null;
      renderResult();
    } catch (e) {
      errorBox.innerHTML = `<div class="add-error">${escapeHtml(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Look up';
    }
  }

  function renderResult() {
    const resultWrap = document.getElementById('ytdl-result-wrap');
    if (!currentLookup) { resultWrap.innerHTML = ''; return; }
    const info = currentLookup;
    resultWrap.innerHTML = `
      <div class="ytdl-video-card">
        ${info.thumbnail ? `<img src="${escapeHtml(info.thumbnail)}" alt="" />` : ''}
        <div class="info">
          <div class="title">${escapeHtml(info.title)}</div>
          <div class="meta">${info.channel ? escapeHtml(info.channel) + ' · ' : ''}${fmtDuration(info.durationSec)}</div>
        </div>
      </div>
      <div class="ytdl-quality-list">
        ${info.options.map((o) => `
          <button class="ytdl-quality-tile${o.id === selectedOptionId ? ' selected' : ''}" data-id="${escapeHtml(o.id)}">
            <div class="label">${escapeHtml(o.label)}</div>
            <div class="res">${escapeHtml(o.resolution)} · ${escapeHtml((o.ext || '').toUpperCase())}</div>
            <div class="size">${escapeHtml(o.sizeLabel)}</div>
            ${o.needsMerge ? '<div class="merge-note">video + audio merged</div>' : ''}
          </button>
        `).join('')}
      </div>
      <button class="btn" id="ytdl-download-btn">Download</button>
      <div id="ytdl-progress-wrap"></div>
    `;
    resultWrap.querySelectorAll('.ytdl-quality-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        selectedOptionId = tile.dataset.id;
        renderResult();
      });
    });
    document.getElementById('ytdl-download-btn').addEventListener('click', startDownload);
  }

  // ---------------- download + progress polling ----------------
  async function startDownload() {
    if (!currentLookup || !selectedOptionId) return;
    const option = currentLookup.options.find((o) => o.id === selectedOptionId);
    if (!option) return;
    const btn = document.getElementById('ytdl-download-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Starting…`;
    try {
      const { id } = await api('/api/ytdownload/jobs', {
        method: 'POST',
        body: {
          videoId: currentLookup.videoId,
          title: currentLookup.title,
          thumbnail: currentLookup.thumbnail,
          formatSelector: option.formatSelector,
          needsMerge: option.needsMerge,
          ext: option.ext,
        },
      });
      if (pollTimer) clearInterval(pollTimer);
      pollJob(id);
      pollTimer = setInterval(() => pollJob(id), 1000);
    } catch (e) {
      showToast(e.message);
      btn.disabled = false;
      btn.textContent = 'Download';
    }
  }

  function renderProgress(job) {
    const wrap = document.getElementById('ytdl-progress-wrap');
    if (!wrap) return;
    if (job.status === 'downloading' || job.status === 'queued') {
      const phaseLabel = job.phase === 'merging' ? 'Merging audio and video…' : 'Downloading…';
      wrap.innerHTML = `
        <div class="ytdl-progress-block">
          <div class="ytdl-phase-label">${phaseLabel}</div>
          <div class="progress-wrap ytdl-progress-wrap"><div class="progress-bar" style="width:${job.percent || 0}%"></div></div>
          <div class="ytdl-progress-row">
            <span>${Math.round(job.percent || 0)}%</span>
            <span>${job.speedText ? job.speedText + ' · ' : ''}${job.etaText ? 'ETA ' + job.etaText : ''}</span>
          </div>
        </div>
      `;
    } else if (job.status === 'done') {
      wrap.innerHTML = `
        <div class="ytdl-progress-block">
          <div class="add-error" style="background:rgba(59,122,87,0.12);border-color:rgba(59,122,87,0.35);color:var(--success);">
            Ready - ${fmtSize(job.finalSizeBytes)}
          </div>
          <a class="btn" style="display:inline-block;margin-top:8px;text-decoration:none;" href="/api/ytdownload/jobs/${job.id}/file" download>Save file</a>
        </div>
      `;
      stopTimers();
      loadHistory();
      historyTimer = setInterval(loadHistory, 5000);
    } else if (job.status === 'error') {
      wrap.innerHTML = `<div class="add-error">${escapeHtml(job.error || 'Download failed.')}</div>`;
      stopTimers();
      loadHistory();
      historyTimer = setInterval(loadHistory, 5000);
    } else if (job.status === 'cancelled') {
      wrap.innerHTML = `<div class="hint">Cancelled.</div>`;
      stopTimers();
    }
  }

  async function pollJob(id) {
    try {
      const job = await api(`/api/ytdownload/jobs/${id}`);
      renderProgress(job);
    } catch (e) {
      if (pollTimer) clearInterval(pollTimer);
    }
  }

  // ---------------- recent downloads (own data file, persists across visits) ----------------
  async function loadHistory() {
    const wrap = document.getElementById('ytdl-history-wrap');
    if (!wrap) { stopTimers(); return; }
    try {
      const jobs = await api('/api/ytdownload/jobs');
      if (jobs.length === 0) {
        wrap.innerHTML = '';
        return;
      }
      wrap.innerHTML = `
        <div class="ytdl-history-title">Recent downloads</div>
        ${jobs.map((j) => `
          <div class="ytdl-history-item" data-id="${j.id}">
            ${j.thumbnail ? `<img src="${escapeHtml(j.thumbnail)}" alt="" />` : ''}
            <div class="info">
              <div class="name">${escapeHtml(j.title || 'Untitled')}</div>
              ${j.status === 'done'
                ? `<div class="meta">${fmtSize(j.finalSizeBytes)} · ${escapeHtml((j.ext || '').toUpperCase())}</div>`
                : j.status === 'error'
                ? `<div class="status-error">${escapeHtml(j.error || 'Failed')}</div>`
                : `<div class="meta">${j.status}${j.percent ? ' · ' + Math.round(j.percent) + '%' : ''}</div>`}
            </div>
            ${j.status === 'done' ? `<a class="dl" href="/api/ytdownload/jobs/${j.id}/file" download>Download</a>` : ''}
            <button class="del-btn" title="Remove" data-id="${j.id}">✕</button>
          </div>
        `).join('')}
      `;
      wrap.querySelectorAll('.del-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await api(`/api/ytdownload/jobs/${btn.dataset.id}`, { method: 'DELETE' });
          loadHistory();
        });
      });
    } catch (e) {
      // history is a bonus, not critical - fail quietly
    }
  }

  function render() {
    stopTimers();
    currentLookup = null;
    selectedOptionId = null;
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = '<span>YouTube Downloader</span>';
    const view = document.getElementById('view');
    view.innerHTML = `
      <h1 class="page-title">YouTube Downloader</h1>
      <div class="ytdl-page-sub">Paste a video link, pick a quality, download it to this PC.</div>
      <div class="ytdl-setup-banner" id="ytdl-setup-banner" style="display:none"></div>
      <div class="panel">
        <div class="ytdl-url-row">
          <input type="url" id="ytdl-url-input" placeholder="https://www.youtube.com/watch?v=..." />
          <button class="btn" id="ytdl-lookup-btn">Look up</button>
        </div>
        <div id="ytdl-lookup-error"></div>
        <div id="ytdl-result-wrap"></div>
      </div>
      <div class="ytdl-history-wrap" id="ytdl-history-wrap"></div>
    `;

    document.getElementById('ytdl-lookup-btn').addEventListener('click', doLookup);
    document.getElementById('ytdl-url-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLookup();
    });

    startSetupFlow();
    loadHistory();
  }

  window.YTDownload = { render };

  // v1.1.0: merge - self-register with app.js's generic subsystem
  // dispatch (see lib/subsystems-registry.js on the server / route()'s
  // window.DexSubsystems fallback in app.js). This is the only wiring
  // this module needed to plug into the show/hide-subsystems system.
  window.DexSubsystems = window.DexSubsystems || {};
  window.DexSubsystems['ytdownload'] = { render };
})();
