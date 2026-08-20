// CCTV subsystem - v1.6.0. Registered as an ordinary subsystem tab
// (lib/subsystems-registry.js id 'cctv'), uses the generic
// window.DexSubsystems fallback in app.js's route(), same as todos.js.
// Fully self-contained: own api/toast helpers, own state.
//
// The page is a live camera grid. Each tile is a plain <img> pointing at
// /api/cctv/stream/<n>?mode=sub which the server pumps as an MJPEG
// multipart stream (ffmpeg RTSP -> MJPEG) - so the video updates itself
// with zero page-level polling. Clicking a tile opens the full-screen
// viewer using that channel's main stream. If nothing is configured yet,
// a setup panel (host / ports / username / password + auto-discovery)
// is shown instead - the exact same settings also live in Settings.
//
// Responsive: the grid is a css auto-fill grid plus orientation/size
// breakpoints in cctv.css - portrait phone = 1 column, landscape phone =
// compact 2+ columns, tablet 2-3, desktop up to 6. All the JS needs to
// know is whether the full-screen viewer is open.
(() => {
  const toastEl = document.getElementById('toast');
  let pollTimer = null;
  let status = null;
  let fsOpen = false;
  let activeChannels = new Set(); // channel ids currently streaming in the grid

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

  const fmtSeen = (ms) => {
    if (!ms) return 'never';
    const d = new Date(ms);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  // ---------------- Setup / connection form ----------------

  // Shared by both this page (when unconfigured) and Settings (always).
  // Accepts a status object so callers control the data source; defaults
  // to this module's own last-fetched status.
  function setupFormHtml(inputStatus) {
    const s = inputStatus || status || {};
    const channelsCount = (s.channels || []).filter((c) => c.enabled).length;
    const connected = s.configured && s.seenRecently;
    const chipClass = connected ? 'on' : '';
    const chipText = connected
      ? `${channelsCount || 'No'} camera${channelsCount === 1 ? '' : 's'} · ${escapeHtml(s.host || '')} · seen ${fmtSeen(s.lastSeenAt)}`
      : s.configured ? `Configured but not reachable (last seen ${fmtSeen(s.lastSeenAt)})${s.lastError ? ` - ${escapeHtml(s.lastError)}` : ''}`
      : 'Not set up yet';
    return `
      <div class="cctv-empty">
        <h2>Cameras</h2>
        <div class="hint" style="margin-bottom:4px;">Live CCTV from your Hikvision DVR, on any device on this network - no login needed here. DEX Labs talks to the DVR in the background using the details below (kept on this PC, never shown on the page).</div>
        <span class="cctv-status-chip" style="margin-bottom:8px;"><span class="cctv-status-light ${chipClass}"></span>${chipText}</span>

        ${connected ? '' : `
        <div style="display:flex; flex-wrap:wrap; gap:10px; width:100%;">
          <label style="flex:2; min-width:180px;">
            <span>DVR address (IP or hostname)</span>
            <input type="text" id="cctv-setup-host" value="${escapeHtml(s.host || '')}" placeholder="e.g. 192.168.1.4" />
          </label>
          <label style="flex:1; min-width:110px;">
            <span>HTTP port</span>
            <input type="number" id="cctv-setup-port" value="${s.port || 80}" min="1" max="65535" />
          </label>
          <label style="flex:1; min-width:110px;">
            <span>RTSP port</span>
            <input type="number" id="cctv-setup-rtsp" value="${s.rtspPort || 554}" min="1" max="65535" />
          </label>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:10px; width:100%;">
          <label style="flex:1; min-width:150px;">
            <span>Username</span>
            <input type="text" id="cctv-setup-user" value="${escapeHtml(s.username || '')}" placeholder="admin" autocomplete="off" />
          </label>
          <label style="flex:1; min-width:150px;">
            <span>Password</span>
            <input type="password" id="cctv-setup-pass" value="${s.password ? '' : ''}" placeholder="${s.passwordSet ? 'saved - leave blank to keep' : ''}" autocomplete="new-password" />
          </label>
        </div>
        <div class="cctv-actions">
          <button class="btn" id="cctv-setup-save">Save & test</button>
          <button class="btn secondary" id="cctv-setup-discover">🔍 Find DVR automatically</button>
        </div>
        <span class="cctv-discovery-result" id="cctv-setup-status"></span>
        `}

        ${connected ? `
        <div class="cctv-actions">
          <button class="btn secondary" id="cctv-setup-edit">Change camera settings</button>
          <button class="btn secondary" id="cctv-refresh-channels">Refresh camera list</button>
        </div>
        <span class="cctv-discovery-result" id="cctv-setup-status"></span>
        ` : ''}
      </div>
    `;
  }

  function wireSetupPanel(inputStatus, containerEl) {
    const s = inputStatus || status || {};
    const statusEl = document.getElementById('cctv-setup-status');
    if (!statusEl) return;
    const mountEl = containerEl || document.getElementById('view');

    const saveBtn = document.getElementById('cctv-setup-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const host = (document.getElementById('cctv-setup-host').value || '').trim();
        const port = Number(document.getElementById('cctv-setup-port').value) || 80;
        const rtspPort = Number(document.getElementById('cctv-setup-rtsp').value) || 554;
        const username = (document.getElementById('cctv-setup-user').value || '').trim();
        const password = document.getElementById('cctv-setup-pass').value;
        if (!host) { statusEl.textContent = 'Enter the DVR address.'; return; }
        if (!username) { statusEl.textContent = 'Enter the username.'; return; }
        statusEl.innerHTML = '<span class="cctv-spinner"></span> Connecting…';
        try {
          const body = { host, port, rtspPort, username };
          if (password) body.password = password; // blank = keep saved
          await api('/api/cctv/creds', { method: 'POST', body });
          showToast('Connected to the DVR');
          location.reload();
        } catch (e) {
          statusEl.textContent = e.message;
        }
      });
    }

    const discoverBtn = document.getElementById('cctv-setup-discover');
    if (discoverBtn) {
      discoverBtn.addEventListener('click', async () => {
        statusEl.innerHTML = '<span class="cctv-spinner"></span> Scanning the network for your DVR…';
        try {
          const result = await api('/api/cctv/discover', { method: 'POST' });
          if (result.ok) {
            showToast('DVR found');
            location.reload();
          } else {
            statusEl.textContent = result.error || 'Could not find a DVR.';
          }
        } catch (e) {
          statusEl.textContent = 'Discovery failed: ' + e.message;
        }
      });
    }

    const editBtn = document.getElementById('cctv-setup-edit');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        // Re-render the editable form into wherever this widget lives -
        // the full CCTV page (mountEl = #view) or the Settings panel's
        // own container - never clobber the whole page from Settings.
        mountEl.innerHTML = setupFormHtml(s);
        wireSetupPanel(s, mountEl);
      });
    }

    const refreshBtn = document.getElementById('cctv-refresh-channels');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        statusEl.innerHTML = '<span class="cctv-spinner"></span> Refreshing camera list…';
        try {
          const result = await api('/api/cctv/refresh', { method: 'POST' });
          showToast('Camera list updated');
          location.reload();
        } catch (e) {
          statusEl.textContent = e.message;
        }
      });
    }
  }

  // ---------------- Grid ----------------

  function tileHtml(ch) {
    const src = `/api/cctv/stream/${ch.id}?mode=sub&w=480&fps=8`;
    return `
      <div class="cctv-tile" data-id="${ch.id}">
        <div class="cctv-tile-video">
          <img src="${src}" alt="${escapeHtml(ch.name)} channel ${ch.id}" loading="lazy" data-src="${src}" />
          <div class="cctv-tile-nosignal"><span>⚠</span><span>No signal - reconnecting…</span></div>
        </div>
        <div class="cctv-tile-bar">
          <span class="cctv-tile-name">${escapeHtml(ch.name)}</span>
          <span class="cctv-tile-live live">LIVE</span>
        </div>
      </div>
    `;
  }

  function gridHtml(channels) {
    const live = channels.filter((c) => c.enabled && (c.mainEnabled || c.subEnabled));
    const on = live.length;
    const total = channels.length;
    return `
      <div class="cctv-toolbar">
        <span class="cctv-status-chip"><span class="cctv-status-light ${on > 0 ? 'on' : ''}"></span>${on} live / ${total} camera${total === 1 ? '' : 's'}</span>
        <span class="cctv-status-chip">DVR: ${escapeHtml((status && status.host) || '—')}</span>
        <div style="flex:1"></div>
        <button class="btn secondary" id="cctv-refresh-btn">⟳ Refresh</button>
        <button class="btn secondary" id="cctv-settings-btn">⚙ Settings</button>
      </div>
      <div class="cctv-grid" id="cctv-grid">
        ${live.length ? live.map(tileHtml).join('') : '<div class="empty-state">No active cameras found. Check the DVR connection in Settings.</div>'}
      </div>
    `;
  }

  // Turns on the reconnect cycle for a tile image: if the stream dies,
  // show the no-signal overlay and retry the URL every few seconds. The
  // load event flips back to live automatically.
  function wireTileImg(img) {
    const tile = img.closest('.cctv-tile');
    const overlay = tile.querySelector('.cctv-tile-nosignal');
    const bar = tile.querySelector('.cctv-tile-live');
    img.addEventListener('load', () => {
      overlay.classList.remove('show');
      bar.classList.add('live');
    });
    img.addEventListener('error', () => {
      overlay.classList.add('show');
      bar.classList.remove('live');
      clearTimeout(wireTileImg._t);
      wireTileImg._t = setTimeout(() => {
        img.src = img.getAttribute('data-src') + '&t=' + Date.now();
      }, 4000);
    });
  }

  function wireTile(tile) {
    const id = Number(tile.dataset.id);
    tile.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openFullscreen(id);
    });
  }

  // ---------------- Fullscreen viewer ----------------

  function openFullscreen(channelId) {
    if (fsOpen) return;
    const ch = (status && status.channels || []).find((c) => c.id === channelId);
    if (!ch) return;
    fsOpen = true;

    const overlay = document.createElement('div');
    overlay.className = 'cctv-fs';
    overlay.innerHTML = `
      <div class="cctv-fs-top">
        <button class="cctv-fs-close" id="cctv-fs-close" aria-label="Close">✕</button>
        <span class="cctv-fs-name">${escapeHtml(ch.name)}</span>
        <button class="btn secondary" id="cctv-fs-snap">Snap</button>
        <button class="btn secondary" id="cctv-fs-mode">HD / SD</button>
      </div>
      <div class="cctv-fs-video" id="cctv-fs-video">
        <img id="cctv-fs-img" src="/api/cctv/stream/${ch.id}?mode=main&w=1280&fps=12" alt="${escapeHtml(ch.name)}" />
        <div class="cctv-fs-nosignal" id="cctv-fs-nosignal"><span>⚠ No signal - reconnecting…</span></div>
      </div>
    `;
    document.body.appendChild(overlay);

    let isMain = true;
    const img = overlay.querySelector('#cctv-fs-img');
    const nosignal = overlay.querySelector('#cctv-fs-nosignal');
    const modeBtn = overlay.querySelector('#cctv-fs-mode');

    img.addEventListener('load', () => nosignal.classList.remove('show'));
    img.addEventListener('error', () => {
      nosignal.classList.add('show');
      clearTimeout(openFullscreen._t);
      openFullscreen._t = setTimeout(() => {
        img.src = `/api/cctv/stream/${ch.id}?mode=${isMain ? 'main' : 'sub'}&w=1280&fps=12&t=${Date.now()}`;
      }, 4000);
    });

    overlay.querySelector('#cctv-fs-close').addEventListener('click', closeFullscreen);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('cctv-fs-video')) closeFullscreen();
    });

    modeBtn.addEventListener('click', () => {
      isMain = !isMain;
      modeBtn.textContent = isMain ? 'HD / SD' : 'SD / HD';
      img.src = `/api/cctv/stream/${ch.id}?mode=${isMain ? 'main' : 'sub'}&w=1280&fps=12&t=${Date.now()}`;
    });

    overlay.querySelector('#cctv-fs-snap').addEventListener('click', async () => {
      const btn = overlay.querySelector('#cctv-fs-snap');
      btn.textContent = '…';
      try {
        const res = await fetch(`/api/cctv/snapshot/${ch.id}?mode=${isMain ? 'main' : 'sub'}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const d = new Date();
        a.download = `camera${ch.id}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        btn.textContent = 'Snap';
        showToast('Snapshot saved');
      } catch (e) {
        btn.textContent = 'Snap';
        showToast('Snapshot failed');
      }
    });

    const keyHandler = (e) => { if (e.key === 'Escape') closeFullscreen(); };
    window.addEventListener('keydown', keyHandler);
    overlay._keyHandler = keyHandler;
  }

  function closeFullscreen() {
    const overlay = document.querySelector('.cctv-fs');
    if (!overlay) return;
    if (overlay._keyHandler) window.removeEventListener('keydown', overlay._keyHandler);
    // Clearing the <img> src closes the MJPEG socket immediately plus
    // removing the node - server sees the socket close and kills ffmpeg.
    const img = overlay.querySelector('img');
    if (img) img.src = '';
    overlay.remove();
    fsOpen = false;
  }

  // ---------------- Render / polling ----------------

  async function loadStatus() {
    try {
      status = await api('/api/cctv/status');
    } catch (e) {
      status = null;
    }
    return status;
  }

  async function renderSub() {
    clearInterval(pollTimer);
    pollTimer = null;
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = '<span>CCTV</span>';
    const view = document.getElementById('view');

    view.innerHTML = '<div class="empty-state">Loading cameras…</div>';
    await loadStatus();

    const configured = status && status.configured;
    if (!configured) {
      view.innerHTML = setupFormHtml();
      wireSetupPanel();
    } else {
      view.innerHTML = gridHtml(status.channels || []);
      Array.from(view.querySelectorAll('.cctv-tile')).forEach((tile) => {
        const img = tile.querySelector('img');
        wireTileImg(img);
        wireTile(tile);
      });
      document.getElementById('cctv-refresh-btn').addEventListener('click', renderSub);
      const settingsBtn = document.getElementById('cctv-settings-btn');
      settingsBtn.addEventListener('click', () => {
        window.setSubsystem('settings');
        location.hash = '#/settings';
      });
    }

    // Keep the "N live / M cameras" chip honest and pick up newly added
    // cameras, without ever touching the live images (those refresh
    // themselves). 30s, same as To-Do.
    pollTimer = setInterval(async () => {
      const prevLive = (status && status.channels || []).filter((c) => c.enabled).length;
      await loadStatus();
      const nextLive = (status && status.channels || []).filter((c) => c.enabled).length;
      if (status && status.configured && prevLive !== nextLive && !document.querySelector('.cctv-fs')) renderSub();
    }, 30000);
  }

  // Expose the setup form so Settings can reuse the exact same widget.
  window.CCTV = {
    render: renderSub,
    setupFormHtml,
    wireSetupPanel,
    cleanup: () => { clearInterval(pollTimer); pollTimer = null; if (fsOpen) closeFullscreen(); },
  };
  window.DexSubsystems = window.DexSubsystems || {};
  window.DexSubsystems['cctv'] = { render: renderSub, cleanup: () => { clearInterval(pollTimer); pollTimer = null; if (fsOpen) closeFullscreen(); } };
})();