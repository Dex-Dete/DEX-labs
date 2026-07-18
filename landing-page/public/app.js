// Landing Page frontend (v1.1.3). Plain vanilla JS, no build step, no
// framework - same "directly editable, directly served" philosophy as
// the rest of this project, kept in its own completely separate file
// tree (landing-page/) from DEX Labs' own public/js/*.js.
(() => {
  const listEl = document.getElementById('sites-list');
  const nameEl = document.getElementById('site-name');
  const portEl = document.getElementById('site-port');
  const pathEl = document.getElementById('site-path');
  const noteEl = document.getElementById('site-note');
  const saveBtn = document.getElementById('site-save-btn');
  const cancelEditBtn = document.getElementById('site-cancel-edit-btn');
  const addPanelTitle = document.getElementById('add-panel-title');
  const errorBox = document.getElementById('add-error');

  let editingId = null; // null = "add" mode, otherwise the site.id being edited
  let pollTimer = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
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

  // Builds the URL for a site using whatever host/address the person
  // actually used to load THIS page (location.hostname) - never a
  // hardcoded IP. That's deliberate: this needs to work identically
  // whether someone's home router hands out 192.168.1.x, 192.168.0.x,
  // 10.0.0.x, or anything else, and even if they're on localhost.
  function siteUrl(site) {
    const path = site.path && site.path.startsWith('/') ? site.path : `/${site.path || ''}`;
    return `http://${location.hostname}:${site.port}${path}`;
  }

  function renderSites(sites) {
    if (sites.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No websites added yet - use the form below to add one (or wait for DEX Labs' own entry to appear).</div>`;
      return;
    }
    // Deliberately a plain full re-render on every poll (unlike
    // v1.1.2's Clock fix) - nothing here has a running CSS animation
    // to interrupt (see the comment on .site-status in style.css), so
    // there's no correctness reason to reconcile in place. Simpler
    // code, same result.
    listEl.innerHTML = sites.map((s) => `
      <div class="site-card" data-id="${s.id}">
        <div class="site-card-top">
          <span class="site-name">${escapeHtml(s.name)}</span>
        </div>
        <span class="site-port">port ${s.port}${s.path && s.path !== '/' ? escapeHtml(s.path) : ''}</span>
        ${s.note ? `<span class="site-note">${escapeHtml(s.note)}</span>` : ''}
        <span class="site-status ${s.online ? 'online' : 'offline'}">
          <span class="site-status-dot"></span>
          <span class="site-status-label">${s.online ? 'Online - tap to open' : 'Not responding right now'}</span>
        </span>
        <a class="site-open-link" href="${siteUrl(s)}" target="_blank" rel="noopener">Open ${escapeHtml(s.name)} →</a>
        <div class="site-card-actions">
          <button class="edit-btn" data-id="${s.id}">Edit</button>
          <button class="danger remove-btn" data-id="${s.id}">Remove</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const site = sites.find((s) => s.id === btn.dataset.id);
        if (site) startEdit(site);
      });
    });
    listEl.querySelectorAll('.remove-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this site from the list? (This only removes it from this page - it does not stop or delete the actual website.)')) return;
        try {
          await api(`/api/sites/${btn.dataset.id}`, { method: 'DELETE' });
          if (editingId === btn.dataset.id) resetForm();
          poll();
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  function startEdit(site) {
    editingId = site.id;
    nameEl.value = site.name;
    portEl.value = site.port;
    pathEl.value = site.path === '/' ? '' : site.path;
    noteEl.value = site.note || '';
    addPanelTitle.textContent = `Edit "${site.name}"`;
    saveBtn.textContent = 'Save changes';
    cancelEditBtn.hidden = false;
    errorBox.innerHTML = '';
    nameEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetForm() {
    editingId = null;
    nameEl.value = '';
    portEl.value = '';
    pathEl.value = '';
    noteEl.value = '';
    addPanelTitle.textContent = 'Add a website';
    saveBtn.textContent = 'Add';
    cancelEditBtn.hidden = true;
    errorBox.innerHTML = '';
  }

  cancelEditBtn.addEventListener('click', resetForm);

  saveBtn.addEventListener('click', async () => {
    errorBox.innerHTML = '';
    const body = {
      name: nameEl.value.trim(),
      port: Number(portEl.value),
      path: pathEl.value.trim(),
      note: noteEl.value.trim(),
    };
    try {
      if (editingId) {
        await api(`/api/sites/${editingId}`, { method: 'PUT', body });
      } else {
        await api('/api/sites', { method: 'POST', body });
      }
      resetForm();
      poll();
    } catch (e) {
      errorBox.innerHTML = `<div class="form-error">${escapeHtml(e.message)}</div>`;
    }
  });

  async function poll() {
    try {
      const sites = await api('/api/sites');
      renderSites(sites);
    } catch (e) {
      listEl.innerHTML = `<div class="empty-state">Could not load the site list: ${escapeHtml(e.message)}</div>`;
    }
  }

  poll();
  // Every 5s - frequent enough to notice a site coming up/going down
  // without hammering a TCP-connect check against every saved port
  // constantly.
  pollTimer = setInterval(poll, 5000);
})();
