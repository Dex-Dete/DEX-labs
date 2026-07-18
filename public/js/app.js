(() => {
  const view = document.getElementById('view');
  const crumbs = document.getElementById('crumbs');
  const toastEl = document.getElementById('toast');
  document.getElementById('brand-home').addEventListener('click', () => { location.hash = '#/'; });
  document.getElementById('nav-settings-btn').addEventListener('click', () => { location.hash = '#/settings'; });
  document.getElementById('server-info-btn').addEventListener('click', showServerInfo);

  // ---- Mobile nav (hamburger slide-in menu) ----------------------------
  // Desktop shows the subsystem nav inline in the topbar as before; below
  // the 768px breakpoint (see style.css) it becomes an off-canvas panel
  // toggled by this button. Purely additive - doesn't change routing.
  const navToggle = document.getElementById('nav-toggle');
  const subsystemNav = document.getElementById('subsystem-nav');
  const navBackdrop = document.getElementById('nav-backdrop');
  function closeMobileNav() {
    subsystemNav.classList.remove('open');
    navBackdrop.classList.remove('show');
    navToggle.setAttribute('aria-expanded', 'false');
  }
  function openMobileNav() {
    subsystemNav.classList.add('open');
    navBackdrop.classList.add('show');
    navToggle.setAttribute('aria-expanded', 'true');
  }
  navToggle.addEventListener('click', () => {
    if (subsystemNav.classList.contains('open')) closeMobileNav();
    else openMobileNav();
  });
  navBackdrop.addEventListener('click', closeMobileNav);
  // v1.0.5: was a one-time querySelectorAll('button').forEach() here, but
  // subsystem buttons are now created dynamically (see loadAndRenderNav
  // below) - event delegation on the nav itself catches clicks on
  // buttons that don't exist yet at page-load time, including any added
  // for a subsystem shipped after this file was written.
  subsystemNav.addEventListener('click', (e) => {
    if (e.target.closest('button')) closeMobileNav();
  });
  window.addEventListener('hashchange', closeMobileNav);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeMobileNav();
  });

  const subsystemLabel = document.getElementById('subsystem-label');
  const navSettingsBtn = document.getElementById('nav-settings-btn');
  const navLinksEl = document.getElementById('nav-links');
  let navButtonEls = {}; // subsystem id -> its <button>, rebuilt each loadAndRenderNav() call
  let lastRegistry = null; // last GET /api/settings/subsystems response - see route()

  // v1.0.5: builds the subsystem nav buttons from the server's registry
  // (lib/subsystems-registry.js) instead of hardcoded HTML, skipping
  // anything currently hidden. Re-run on every route() call (cheap - a
  // handful of buttons) so the nav and hide-enforcement below are always
  // working from the current settings, not a stale snapshot from page
  // load - e.g. if you change visibility in Settings then click back to
  // another subsystem, the nav updates immediately.
  async function loadAndRenderNav() {
    let registry;
    try {
      const res = await fetch('/api/settings/subsystems');
      registry = await res.json();
    } catch (e) {
      registry = { subsystems: [], hiddenSubsystems: [], defaultLandingSubsystem: 'lessons' };
    }
    lastRegistry = registry;
    const hidden = new Set(registry.hiddenSubsystems || []);
    navLinksEl.innerHTML = '';
    navButtonEls = {};
    (registry.subsystems || []).forEach((s) => {
      if (hidden.has(s.id)) return;
      const btn = document.createElement('button');
      btn.className = 'nav-link';
      btn.id = `nav-${s.id}-btn`;
      btn.title = s.label;
      btn.textContent = s.navLabel;
      btn.addEventListener('click', () => { location.hash = s.hash; });
      navLinksEl.appendChild(btn);
      navButtonEls[s.id] = btn;
    });
    return registry;
  }

  // Every DEX Labs subsystem calls this (with its registry id, or
  // 'settings') so the top bar always shows which one you're currently
  // in and the right nav button is highlighted.
  window.setSubsystem = function setSubsystem(id) {
    const entry = (lastRegistry && lastRegistry.subsystems || []).find((s) => s.id === id);
    subsystemLabel.textContent = entry ? entry.label : (id === 'settings' ? 'Settings' : id);
    Object.keys(navButtonEls).forEach((k) => navButtonEls[k].classList.toggle('active', k === id));
    navSettingsBtn.classList.toggle('active', id === 'settings');
  };

  const TAB_COLORS = ['#c0392b', '#d9a32b', '#3b7a57', '#4a6fa5', '#8e5aa8', '#c76b3e'];
  function colorFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return TAB_COLORS[h % TAB_COLORS.length];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // v1.1.2: the "what's new" banner was dumping the raw GitHub release
  // body (real Markdown - **bold**, "- " lists, "# " headings, etc.)
  // through escapeHtml() and straight into the page, so it displayed
  // literally, asterisks/hashes and all, instead of being formatted.
  // This is a small, dependency-free Markdown -> HTML converter (no
  // build step in this project, so pulling in a real Markdown library
  // isn't a great fit for one banner) covering what GitHub release
  // notes actually use in practice: headings, bold/italic, inline
  // code, links, bullet/numbered lists, and paragraphs.
  //
  // Security note: every text run is escaped via escapeHtml() FIRST,
  // then the (now inert) escaped text is what gets wrapped in real
  // tags - so anything that looked like an HTML tag in the release
  // body can't come back to life as one. Link targets are restricted
  // to http(s) URLs; anything else falls back to plain text so this
  // can't be used to smuggle a javascript: URL.
  function renderMarkdownLite(md) {
    const escaped = escapeHtml(md).replace(/\r\n/g, '\n');

    // Inline formatting - order matters (code before bold/italic so
    // markup characters inside `code spans` aren't touched).
    function inline(text) {
      text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
      text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
      text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return text;
    }

    const lines = escaped.split('\n');
    const htmlParts = [];
    let listMode = null; // 'ul' | 'ol' | null
    let para = [];

    function flushPara() {
      if (para.length) { htmlParts.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    }
    function closeList() {
      if (listMode) { htmlParts.push(`</${listMode}>`); listMode = null; }
    }

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      const bullet = line.match(/^[-*]\s+(.*)$/);
      const numbered = line.match(/^\d+\.\s+(.*)$/);

      if (!line) { flushPara(); closeList(); continue; }
      if (heading) {
        flushPara(); closeList();
        const level = Math.min(6, heading[1].length + 2); // keep headings modest inside a modal
        htmlParts.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      } else if (bullet) {
        flushPara();
        if (listMode !== 'ul') { closeList(); htmlParts.push('<ul>'); listMode = 'ul'; }
        htmlParts.push(`<li>${inline(bullet[1])}</li>`);
      } else if (numbered) {
        flushPara();
        if (listMode !== 'ol') { closeList(); htmlParts.push('<ol>'); listMode = 'ol'; }
        htmlParts.push(`<li>${inline(numbered[1])}</li>`);
      } else {
        closeList();
        para.push(line);
      }
    }
    flushPara();
    closeList();
    return htmlParts.join('\n');
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // Generic overlay modal, used for the lesson "Details" view. Closes on
  // backdrop click, the × button, or Escape.
  function showModal(titleHtml, bodyHtml) {
    let overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <div class="modal-title">${titleHtml}</div>
          <button class="modal-close" id="modal-close-btn">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#modal-close-btn').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return { close };
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

  function uploadFiles(subjectId, files, onProgress) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/subjects/${subjectId}/tutes`);
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

  async function showServerInfo() {
    try {
      const info = await api('/api/server-info');
      const lines = info.addresses.length
        ? info.addresses.map((a) => `http://${a}:${info.port}`).join('\n')
        : 'No LAN address detected - check your WiFi connection.';
      alert('Open this on any phone/PC on the same WiFi:\n\n' + lines);
    } catch (e) {
      alert('Could not read server info.');
    }
  }

  // Shows the running server's version at the bottom of every page - if
  // this doesn't match what you expect after an update, your browser is
  // showing a cached copy of the page; hard-refresh (Ctrl+Shift+R) to fix.
  (async () => {
    try {
      const info = await api('/api/server-info');
      document.getElementById('build-footer').textContent = `DEX Labs v${info.version}`;
    } catch (e) { /* not critical */ }
  })();

  // v1.0.5: "what's new" banner. Once, right after an update, show the
  // newest GitHub release's notes in a big modal with a link to the full
  // releases page and an OK button. Clicking OK tells the server this
  // version has been seen (GET/POST /api/settings/updates/*), so it
  // won't show again until DEX Labs updates again to something newer.
  // Closing any other way (✕/Escape/backdrop) does NOT acknowledge it -
  // it'll just show again next visit, same as not having seen it yet.
  (async () => {
    try {
      const info = await api('/api/settings/updates/latest');
      if (!info.shouldShow || !info.release) return;
      const bodyText = info.release.body ? renderMarkdownLite(info.release.body) : 'No description was provided with this release.';
      const modal = showModal(
        `🎉 What's new in v${escapeHtml(info.currentVersion)}${info.release.name ? ' - ' + escapeHtml(info.release.name) : ''}`,
        `
          <div class="update-banner-body">${bodyText}</div>
          <a class="update-banner-link" href="${info.releasesUrl}" target="_blank" rel="noopener">See all releases on GitHub →</a>
          <div class="update-banner-footer"><button class="btn" id="update-banner-ok-btn">OK</button></div>
        `
      );
      document.getElementById('update-banner-ok-btn').addEventListener('click', async () => {
        try { await api('/api/settings/updates/ack', { method: 'POST' }); } catch (e) { /* best effort */ }
        modal.close();
      });
    } catch (e) { /* not critical - just skip the banner */ }
  })();

  // ---------------- Router ----------------
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', route);

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    return h.split('/').filter(Boolean);
  }

  async function route() {
    const registry = await loadAndRenderNav();
    const hidden = new Set(registry.hiddenSubsystems || []);
    const parts = parseHash();
    try {
      // v1.0.5: forced first-run setup. Until the user has saved their
      // AirDrop settings once (setupComplete in data/config.json), every
      // navigation gets bounced to Settings - same idea as an app that
      // won't let you past onboarding. Settings itself is always exempt
      // (otherwise nobody could ever reach the form that unblocks them).
      if (parts[0] !== 'settings' && window.Settings) {
        const ready = await window.Settings.isSetupComplete();
        if (!ready) {
          window.setSubsystem('settings');
          return window.Settings.render();
        }
      }

      // AirDrop, Daily Schedule, Clock (id 'timers' - Timer/Alarm/
      // Stopwatch menus, see public/js/timers.js), and Settings are
      // separate feature modules (see /js/airdrop.js, /js/schedule.js,
      // /js/timers.js, /js/settings.js) - dispatch() just forwards to
      // them rather than reimplementing anything of their own. For
      // Clock, parts[1] (if present) is which of its 3 menus to open -
      // e.g. '#/timers/stopwatch' -> render('stopwatch'). Anything NOT
      // special-cased here falls through to window.DexSubsystems -
      // that's the zero-app.js-edits path future subsystems use (see
      // lib/subsystems-registry.js).
      function dispatch(id) {
        window.setSubsystem(id);
        if (id === 'lessons') return renderSubjects();
        if (id === 'airdrop') return window.Airdrop.render();
        if (id === 'schedule') return window.Schedule.render();
        if (id === 'timers') return window.Timers.render(parts[1]);
        // v1.1.5: Study has its own Study/Stats/Calendar sub-tabs, same
        // "#/<id>/<subtab>" shape as Clock's Timer/Alarm/Stopwatch above -
        // special-cased here for the same reason: the generic
        // window.DexSubsystems fallback below calls render() with no
        // arguments, which would lose which sub-tab was requested.
        if (id === 'study') return window.Study.render(parts[1]);
        if (id === 'settings') return window.Settings.render();
        const generic = window.DexSubsystems && window.DexSubsystems[id];
        if (generic && typeof generic.render === 'function') return generic.render(parts[1]);
        return renderSubjects(); // unknown id - fall back rather than a blank page
      }

      // v1.0.5: which subsystem loads when the site is opened with no
      // hash. Normally Lesson Tracker, but if that's been hidden (or
      // whatever's configured as default has been hidden), Settings'
      // PUT /api/settings/subsystems already re-picks a visible one
      // server-side - this just re-derives the same fallback in case the
      // registry was fetched slightly stale.
      function landingId() {
        let id = registry.defaultLandingSubsystem || 'lessons';
        if (hidden.has(id)) {
          const firstVisible = (registry.subsystems || []).find((s) => !hidden.has(s.id));
          id = firstVisible ? firstVisible.id : 'settings';
        }
        return id;
      }

      if (parts.length === 0) return dispatch(landingId());
      if (parts[0] === 'settings') return dispatch('settings');

      // v1.0.5: enforce hiding. A hidden subsystem is blocked from direct
      // hash navigation too, not just removed from the nav - bounce home
      // instead (which re-runs route() via the hashchange listener).
      // Lesson Tracker's subpages all live under '#/subject/...', so they
      // belong to the 'lessons' id for this check.
      const ownerId = parts[0] === 'subject' ? 'lessons' : parts[0];
      if (hidden.has(ownerId)) { location.hash = '#/'; return; }

      if (parts[0] === 'airdrop') return dispatch('airdrop');
      if (parts[0] === 'schedule') return dispatch('schedule');
      if (parts[0] === 'timers') return dispatch('timers');
      if (parts[0] === 'subject') {
        window.setSubsystem('lessons');
        if (parts[1] && !parts[2]) return renderSubjectHome(parts[1]);
        if (parts[1] === undefined) return renderSubjects();
        if (parts[2] === 'grade' && !parts[3]) return renderGradeChoice(parts[1]);
        if (parts[2] === 'grade' && parts[3]) return renderLessons(parts[1], parts[3]);
        if (parts[2] === 'tutes') return renderTutes(parts[1]);
        return renderSubjects();
      }

      // Not one of the built-ins above - maybe a subsystem shipped after
      // this file was written, self-registered via window.DexSubsystems.
      if (window.DexSubsystems && window.DexSubsystems[parts[0]]) return dispatch(parts[0]);

      dispatch(landingId());
    } catch (e) {
      view.innerHTML = `<div class="empty-state">Something went wrong: ${escapeHtml(e.message)}</div>`;
    }
  }

  function setCrumbs(items) {
    crumbs.innerHTML = items
      .map((it, i) => (i === items.length - 1
        ? `<span>${escapeHtml(it.label)}</span>`
        : `<a data-href="${it.href}">${escapeHtml(it.label)}</a> &nbsp;/&nbsp; `))
      .join('');
    crumbs.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => { location.hash = a.dataset.href; });
    });
  }

  // ---------------- Views ----------------
  async function renderSubjects() {
    setCrumbs([{ label: 'Subjects', href: '#/' }]);
    view.innerHTML = `<h1 class="page-title">Your Subjects</h1><div class="grid" id="subj-grid"><div class="empty-state">Loading…</div></div>`;
    const subjects = await api('/api/subjects');
    const grid = document.getElementById('subj-grid');
    grid.innerHTML = subjects.map((s) => `
      <div class="subject-card" style="--tab-color:${colorFor(s.id)}" data-id="${s.id}">
        <h3>${escapeHtml(s.name)}</h3>
        <div class="meta">Grades &amp; Tutes</div>
      </div>
    `).join('') + `<div class="add-card" id="add-subject-card">+ Add subject</div>`;

    grid.querySelectorAll('.subject-card').forEach((card) => {
      card.addEventListener('click', () => { location.hash = `#/subject/${card.dataset.id}`; });
    });
    document.getElementById('add-subject-card').addEventListener('click', async () => {
      const name = prompt('New subject name:');
      if (!name || !name.trim()) return;
      try {
        await api('/api/subjects', { method: 'POST', body: { name: name.trim() } });
        showToast('Subject added');
        renderSubjects();
      } catch (e) { showToast(e.message); }
    });
  }

  async function renderSubjectHome(subjectId) {
    const subjects = await api('/api/subjects');
    const subject = subjects.find((s) => s.id === subjectId);
    if (!subject) { location.hash = '#/'; return; }
    setCrumbs([{ label: 'Subjects', href: '#/' }, { label: subject.name, href: `#/subject/${subjectId}` }]);
    view.innerHTML = `
      <h1 class="page-title">${escapeHtml(subject.name)}</h1>
      <div class="choice-row">
        <div class="choice-tile grade10" id="tile-grades">
          <div class="big-label">Grades</div>
          <div class="desc">Recorded YouTube lessons, by grade</div>
        </div>
        <div class="choice-tile" id="tile-tutes">
          <div class="big-label">📄 Tutes</div>
          <div class="desc">PDF, ZIP and other files (up to 5GB each)</div>
        </div>
      </div>
    `;
    document.getElementById('tile-grades').addEventListener('click', () => { location.hash = `#/subject/${subjectId}/grade`; });
    document.getElementById('tile-tutes').addEventListener('click', () => { location.hash = `#/subject/${subjectId}/tutes`; });
  }

  async function renderGradeChoice(subjectId) {
    const subjects = await api('/api/subjects');
    const subject = subjects.find((s) => s.id === subjectId);
    if (!subject) { location.hash = '#/'; return; }
    const categories = subject.categories || [];
    setCrumbs([
      { label: 'Subjects', href: '#/' },
      { label: subject.name, href: `#/subject/${subjectId}` },
      { label: 'Grades', href: `#/subject/${subjectId}/grade` },
    ]);
    view.innerHTML = `
      <h1 class="page-title">${escapeHtml(subject.name)} — Choose a category</h1>
      <div class="hint" style="margin-bottom:10px;">Double-click a category to rename it (e.g. change "Grade 10" to "Revision"). Use ✕ to delete an empty category.</div>
      <div class="choice-row category-row">
        ${categories.map((c) => `
          <div class="choice-tile category-tile" data-id="${c.id}">
            <button class="category-del-btn" title="Delete category" data-id="${c.id}">✕</button>
            <div class="big-label" data-role="label">${escapeHtml(c.name)}</div>
            <div class="desc">View / add lessons</div>
          </div>
        `).join('')}
        <div class="choice-tile add-category-tile" id="add-category-tile">
          <div class="big-label">+ Add category</div>
          <div class="desc">e.g. Revision, Extra Practice</div>
        </div>
      </div>
    `;

    view.querySelectorAll('.category-tile').forEach((tile) => {
      const catId = tile.dataset.id;
      tile.addEventListener('click', (e) => {
        if (e.target.closest('[data-role="label"]') && tile.classList.contains('editing')) return;
        if (e.target.closest('.category-del-btn')) return;
        location.hash = `#/subject/${subjectId}/grade/${catId}`;
      });
      const label = tile.querySelector('[data-role="label"]');
      label.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const current = categories.find((c) => c.id === catId);
        const name = prompt('Rename category:', current ? current.name : '');
        if (!name || !name.trim()) return;
        try {
          await api(`/api/subjects/${subjectId}/categories/${catId}`, { method: 'PATCH', body: { name: name.trim() } });
          renderGradeChoice(subjectId);
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    view.querySelectorAll('.category-del-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const catId = btn.dataset.id;
        const current = categories.find((c) => c.id === catId);
        if (!confirm(`Delete category "${current ? current.name : catId}"? This only works if it has no lessons in it.`)) return;
        try {
          await api(`/api/subjects/${subjectId}/categories/${catId}`, { method: 'DELETE' });
          renderGradeChoice(subjectId);
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    document.getElementById('add-category-tile').addEventListener('click', async () => {
      const name = prompt('New category name (e.g. "Revision", "Grade 12"):');
      if (!name || !name.trim()) return;
      try {
        await api(`/api/subjects/${subjectId}/categories`, { method: 'POST', body: { name: name.trim() } });
        renderGradeChoice(subjectId);
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  async function renderLessons(subjectId, grade) {
    const subjects = await api('/api/subjects');
    const subject = subjects.find((s) => s.id === subjectId);
    if (!subject) { location.hash = '#/'; return; }
    const category = (subject.categories || []).find((c) => c.id === grade);
    const categoryName = category ? category.name : grade;
    setCrumbs([
      { label: 'Subjects', href: '#/' },
      { label: subject.name, href: `#/subject/${subjectId}` },
      { label: 'Grades', href: `#/subject/${subjectId}/grade` },
      { label: categoryName, href: `#/subject/${subjectId}/grade/${grade}` },
    ]);
    view.innerHTML = `
      <h1 class="page-title">${escapeHtml(subject.name)} — ${escapeHtml(categoryName)}</h1>
      <div class="panel">
        <div class="form-row">
          <input type="url" id="yt-url" placeholder="Paste a YouTube video or playlist link" />
          <button class="btn" id="yt-add-btn">Add</button>
        </div>
        <div class="hint">Pasting a playlist link automatically adds every video in it.</div>
        <div id="yt-add-error"></div>
      </div>
      <div id="lessons-wrap"><div class="empty-state">Loading…</div></div>
    `;

    async function loadLessons() {
      const lessons = await api(`/api/subjects/${subjectId}/lessons?grade=${grade}`);
      const wrap = document.getElementById('lessons-wrap');
      if (lessons.length === 0) {
        wrap.innerHTML = `<div class="empty-state">No lessons yet. Paste a YouTube link above to add the first one.</div>`;
        return;
      }
      const watchedCount = lessons.filter((l) => l.watched).length;
      wrap.innerHTML = `
        <div class="watch-progress">${watchedCount} of ${lessons.length} watched</div>
        <div class="lesson-list">${lessons.map((l) => `
        <div class="lesson-item${l.watched ? ' watched' : ''}" data-id="${l.id}">
          <div class="thumb-wrap" data-id="${l.id}" title="Click to mark as ${l.watched ? 'unwatched' : 'watched'}">
            <img src="${l.thumbnail || ''}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>
            <span class="watched-badge">✓ Watched</span>
          </div>
          <div class="info">
            <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title)}</a>
            ${l.playlistTitle ? `<span class="tag">${escapeHtml(l.playlistTitle)}</span>` : ''}
          </div>
          <button class="info-btn" title="View full title and description" data-id="${l.id}">ⓘ</button>
          <button class="del-btn" title="Remove" data-id="${l.id}">✕</button>
        </div>
      `).join('')}</div>`;
      wrap.querySelectorAll('.del-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Remove this lesson?')) return;
          await api(`/api/lessons/${btn.dataset.id}`, { method: 'DELETE' });
          loadLessons();
        });
      });
      wrap.querySelectorAll('.info-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const lesson = lessons.find((l) => l.id === btn.dataset.id);
          const modal = showModal('Loading…', '<div class="empty-state">Fetching details from YouTube…</div>');
          try {
            const details = await api(`/api/lessons/${btn.dataset.id}/details`);
            modal.close();
            showModal(
              escapeHtml(details.title || lesson.title),
              `<p class="modal-description">${escapeHtml(details.description).replace(/\n/g, '<br>')}</p>
               <a class="btn" href="${escapeHtml(lesson.url)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;text-decoration:none;">Open on YouTube</a>`
            );
          } catch (e) {
            modal.close();
            showModal(escapeHtml(lesson.title), `<p class="modal-description">${escapeHtml(e.message)}</p>`);
          }
        });
      });
      wrap.querySelectorAll('.thumb-wrap').forEach((thumb) => {
        thumb.addEventListener('click', async () => {
          const item = thumb.closest('.lesson-item');
          const nowWatched = !item.classList.contains('watched');
          // Optimistic UI - flip it instantly, then confirm with the server.
          item.classList.toggle('watched', nowWatched);
          try {
            await api(`/api/lessons/${thumb.dataset.id}/watched`, { method: 'PATCH', body: { watched: nowWatched } });
            loadLessons();
          } catch (e) {
            item.classList.toggle('watched', !nowWatched); // revert on failure
            showToast(e.message);
          }
        });
      });
    }
    loadLessons();

    document.getElementById('yt-add-btn').addEventListener('click', async () => {
      const input = document.getElementById('yt-url');
      const url = input.value.trim();
      const errorBox = document.getElementById('yt-add-error');
      errorBox.innerHTML = '';
      if (!url) return;
      const btn = document.getElementById('yt-add-btn');
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>Adding…`;
      try {
        const result = await api(`/api/subjects/${subjectId}/lessons`, { method: 'POST', body: { grade, url } });
        showToast(`Added ${result.added.length} lesson${result.added.length > 1 ? 's' : ''}`);
        if (result.warning) {
          errorBox.innerHTML = `<div class="add-error add-warning">${escapeHtml(result.warning)}</div>`;
        }
        input.value = '';
        loadLessons();
      } catch (e) {
        // Persistent, not a fleeting toast - playlist failures especially
        // need a message you can actually read and act on (or copy to me).
        errorBox.innerHTML = `<div class="add-error">${escapeHtml(e.message)}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Add';
      }
    });
  }

  async function renderTutes(subjectId) {
    const subjects = await api('/api/subjects');
    const subject = subjects.find((s) => s.id === subjectId);
    if (!subject) { location.hash = '#/'; return; }
    setCrumbs([
      { label: 'Subjects', href: '#/' },
      { label: subject.name, href: `#/subject/${subjectId}` },
      { label: 'Tutes', href: `#/subject/${subjectId}/tutes` },
    ]);
    view.innerHTML = `
      <h1 class="page-title">${escapeHtml(subject.name)} — Tutes</h1>
      <div class="panel">
        <div class="dropzone" id="dropzone">
          Tap to choose files, or drag &amp; drop here<br/>
          <span class="hint">PDF, ZIP, or any file type — up to 5GB each</span>
        </div>
        <input type="file" id="file-input" multiple style="display:none" />
        <div id="upload-status"></div>
      </div>
      <div id="tutes-wrap"><div class="empty-state">Loading…</div></div>
    `;

    async function loadTutes() {
      const tutes = await api(`/api/subjects/${subjectId}/tutes`);
      const wrap = document.getElementById('tutes-wrap');
      if (tutes.length === 0) {
        wrap.innerHTML = `<div class="empty-state">No files yet. Add a tute above.</div>`;
        return;
      }
      wrap.innerHTML = `<div class="file-list">${tutes.map((t) => `
        <div class="file-item" data-id="${t.id}">
          <div class="ficon">${escapeHtml(extBadge(t.originalName))}</div>
          <div class="info">
            <div class="name">${escapeHtml(t.originalName)}</div>
            <div class="size">${fmtSize(t.size)}</div>
          </div>
          <a class="dl" href="/api/tutes/${t.id}/download" download>Download</a>
          <button class="del-btn" title="Delete" data-id="${t.id}">✕</button>
        </div>
      `).join('')}</div>`;
      wrap.querySelectorAll('.del-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this file? This cannot be undone.')) return;
          await api(`/api/tutes/${btn.dataset.id}`, { method: 'DELETE' });
          loadTutes();
        });
      });
    }
    loadTutes();

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const statusEl = document.getElementById('upload-status');

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
        <div class="progress-wrap"><div class="progress-bar" id="pbar"></div></div>
      `;
      const pbar = document.getElementById('pbar');
      uploadFiles(subjectId, files, (frac) => { pbar.style.width = `${Math.round(frac * 100)}%`; })
        .then(() => {
          statusEl.innerHTML = '';
          showToast('Uploaded');
          fileInput.value = '';
          loadTutes();
        })
        .catch((e) => {
          statusEl.innerHTML = `<div class="upload-row">${escapeHtml(e.message)}</div>`;
        });
    }
  }
})();
