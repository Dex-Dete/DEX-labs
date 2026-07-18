// Study subsystem. Fully self-contained, same isolation pattern as
// airdrop.js/schedule.js/timers.js - own toast/api helpers, own state,
// no references to any other subsystem's code or data.
//
// 3 menus (like Clock's Timer/Alarm/Stopwatch tab shell):
//   Study    - manage subjects, start/run a focus session (Stopwatch or
//              Pomodoro), stop & save it.
//   Stats    - hours studied per subject (pie + bar), total sessions,
//              and how many days this year were Studied / Slept / Did
//              nothing.
//   Calendar - a GitHub-style "every day of the year, lit up by how
//              much you studied" heatmap, with manual Slept/Did-nothing
//              marking for days with no session.
//
// The active session is server-authoritative (lib/study-store.js) -
// this page polls it every second and derives everything it shows
// (remaining time, current Pomodoro phase, etc.) from what the server
// returns, the same way timers.js does for Clock's Timer/Alarm/
// Stopwatch. Pomodoro study/rest length settings are edited here but
// persisted forever on the server (data/study.json) - see the big
// comment above setSettings() in lib/study-store.js for exactly why
// changing them can never retroactively change a session already
// running or already saved.
(() => {
  const toastEl = document.getElementById('toast');
  let pollTimer = null;
  let audioCtx = null;
  let lastPhase = null; // tracks Pomodoro phase across polls, to beep on transition
  let selectedMethod = 'stopwatch';
  let pendingSubjectId = null; // subject picked, waiting on method choice
  let statsYear = new Date().getFullYear();
  let calendarYear = new Date().getFullYear();
  let selectedDay = null; // currently selected heatmap cell, Calendar tab

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

  function elFromHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  // mm:ss / h:mm:ss counting either up (stopwatch/elapsed) or down
  // (Pomodoro phase remaining) - same digits either way.
  function fmtClock(ms) {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // "3h 25m" style, for stats tiles/bars where second-level precision
  // isn't useful.
  function fmtHoursShort(ms) {
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  // A small browser-side beep (Web Audio) when a Pomodoro phase
  // changes (study -> rest or rest -> study). This is a foreground
  // feature (you're looking at the page while studying), unlike Clock's
  // alarm which needs to reach real speakers even with no browser open -
  // so no server-side beep is needed here, see lib/study-store.js's
  // header comment for the full reasoning.
  function playPhaseBeep(toRest) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = toRest ? 520 : 880;
      osc.type = 'sine';
      gain.gain.value = 0.3;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      setTimeout(() => osc.stop(), 300);
    } catch (e) { /* autoplay policy etc - not critical */ }
  }

  const STUDY_PALETTE = ['#4b3f8f', '#c0392b', '#d9a32b', '#3b7a57', '#1f7a6c', '#8e5aa8', '#c76b3e', '#4a6fa5'];
  function colorForSubject(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return STUDY_PALETTE[h % STUDY_PALETTE.length];
  }

  // ---------------- Tab menu shell ----------------

  const TABS = [
    { id: 'study', label: '📖 Study' },
    { id: 'stats', label: '📊 Stats' },
    { id: 'calendar', label: '🗓 Calendar' },
  ];

  function renderShell(tab) {
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = `<span>Study</span><span> / </span><span>${escapeHtml(TABS.find((t) => t.id === tab).label.replace(/^\S+\s/, ''))}</span>`;
    const view = document.getElementById('view');
    view.innerHTML = `
      <h1 class="page-title">Study</h1>
      <div class="study-tabs" id="study-tabs">
        ${TABS.map((t) => `<button class="study-tab-btn${t.id === tab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div id="study-tab-body"></div>
    `;
    document.querySelectorAll('.study-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        location.hash = target === 'study' ? '#/study' : `#/study/${target}`;
      });
    });
  }

  // ================= STUDY tab (subjects + focus session) =================

  async function renderStudyTab() {
    const body = document.getElementById('study-tab-body');
    body.innerHTML = `<div class="empty-state">Loading…</div>`;
    let active;
    try {
      active = await api('/api/study/active');
    } catch (e) {
      body.innerHTML = `<div class="empty-state">Could not load: ${escapeHtml(e.message)}</div>`;
      return;
    }
    if (active) {
      lastPhase = active.phase || null;
      renderFocusView(active);
      pollTimer = setInterval(pollFocus, 1000);
    } else {
      pendingSubjectId = null;
      await renderSubjectPicker();
    }
  }

  async function renderSubjectPicker() {
    const body = document.getElementById('study-tab-body');
    let subjects, settings;
    try {
      [subjects, settings] = await Promise.all([
        api('/api/study/subjects'),
        api('/api/study/settings'),
      ]);
    } catch (e) {
      body.innerHTML = `<div class="empty-state">Could not load: ${escapeHtml(e.message)}</div>`;
      return;
    }
    body.innerHTML = `
      <div class="study-page-sub">Pick a subject, or add a new one, then start studying.</div>
      <div class="panel">
        <div class="form-row">
          <input type="text" id="study-new-subject" placeholder="New subject (e.g. Chemistry)" maxlength="60" />
          <button class="btn" id="study-add-subject-btn">Add</button>
        </div>
        <div id="study-add-error"></div>
      </div>
      <div class="study-subjects-grid" id="study-subjects-grid"></div>
      <div id="study-method-panel"></div>
    `;
    const grid = document.getElementById('study-subjects-grid');
    if (subjects.length === 0) {
      grid.innerHTML = `<div class="empty-state">No subjects yet - add one above to get started.</div>`;
    } else {
      subjects.forEach((s) => {
        const card = elFromHtml(`
          <div class="study-subject-card" data-id="${s.id}">
            <div class="study-subject-name">${escapeHtml(s.name)}</div>
            <div class="study-subject-total">Click to start studying</div>
            <button class="study-subject-del-btn" data-id="${s.id}" title="Delete subject">✕</button>
          </div>
        `);
        card.addEventListener('click', (e) => {
          if (e.target.closest('.study-subject-del-btn')) return;
          pendingSubjectId = s.id;
          renderMethodPanel(s, settings);
        });
        card.querySelector('.study-subject-del-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete "${s.name}"? Past study sessions logged under it are kept.`)) return;
          try {
            await api(`/api/study/subjects/${s.id}`, { method: 'DELETE' });
            renderSubjectPicker();
          } catch (err) { showToast(err.message); }
        });
        grid.appendChild(card);
      });
    }

    document.getElementById('study-add-subject-btn').addEventListener('click', async () => {
      const input = document.getElementById('study-new-subject');
      const errBox = document.getElementById('study-add-error');
      errBox.innerHTML = '';
      try {
        await api('/api/study/subjects', { method: 'POST', body: { name: input.value } });
        input.value = '';
        renderSubjectPicker();
      } catch (e) {
        errBox.innerHTML = `<div class="add-error">${escapeHtml(e.message)}</div>`;
      }
    });
    document.getElementById('study-new-subject').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('study-add-subject-btn').click();
    });
  }

  function renderMethodPanel(subject, settings) {
    selectedMethod = 'stopwatch';
    const panel = document.getElementById('study-method-panel');
    panel.innerHTML = `
      <div class="panel study-method-panel">
        <h3>Study "${escapeHtml(subject.name)}"</h3>
        <div class="study-method-choice">
          <button class="study-method-btn selected" data-method="stopwatch">⏲ Stopwatch<br><span class="hint">Just count up, no breaks</span></button>
          <button class="study-method-btn" data-method="pomodoro">🍅 Pomodoro<br><span class="hint">Study/rest cycles</span></button>
        </div>
        <div class="study-pomodoro-settings" id="study-pomodoro-settings" style="display:none">
          <label>Study minutes
            <input type="number" id="study-pomo-study" min="1" max="180" value="${settings.pomodoroStudyMin}" />
          </label>
          <label>Rest minutes
            <input type="number" id="study-pomo-rest" min="1" max="60" value="${settings.pomodoroRestMin}" />
          </label>
          <button class="btn secondary" id="study-pomo-save-btn">Save as default</button>
        </div>
        <div class="study-settings-note" id="study-pomo-note" style="display:none">These minutes are saved forever and reused every time you start a Pomodoro session - changing them later never changes a session already in progress or already saved.</div>
        <div class="study-method-choice">
          <button class="btn" id="study-begin-btn">Begin studying</button>
          <button class="btn secondary" id="study-cancel-pick-btn">Cancel</button>
        </div>
        <div id="study-begin-error"></div>
      </div>
    `;
    panel.querySelectorAll('.study-method-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedMethod = btn.dataset.method;
        panel.querySelectorAll('.study-method-btn').forEach((b) => b.classList.toggle('selected', b === btn));
        const isPomo = selectedMethod === 'pomodoro';
        document.getElementById('study-pomodoro-settings').style.display = isPomo ? 'flex' : 'none';
        document.getElementById('study-pomo-note').style.display = isPomo ? 'block' : 'none';
      });
    });
    document.getElementById('study-pomo-save-btn').addEventListener('click', async () => {
      try {
        const studyMin = document.getElementById('study-pomo-study').value;
        const restMin = document.getElementById('study-pomo-rest').value;
        settings = await api('/api/study/settings', { method: 'PUT', body: { pomodoroStudyMin: studyMin, pomodoroRestMin: restMin } });
        showToast('Pomodoro default saved');
      } catch (e) { showToast(e.message); }
    });
    document.getElementById('study-cancel-pick-btn').addEventListener('click', () => { panel.innerHTML = ''; });
    document.getElementById('study-begin-btn').addEventListener('click', async () => {
      const errBox = document.getElementById('study-begin-error');
      errBox.innerHTML = '';
      try {
        // If Pomodoro is picked with unsaved edits to the minutes
        // fields, save them first so this session (which freezes
        // whatever `settings` currently holds) uses the values on
        // screen rather than a stale in-memory copy.
        if (selectedMethod === 'pomodoro') {
          const studyMin = document.getElementById('study-pomo-study').value;
          const restMin = document.getElementById('study-pomo-rest').value;
          await api('/api/study/settings', { method: 'PUT', body: { pomodoroStudyMin: studyMin, pomodoroRestMin: restMin } });
        }
        await api('/api/study/active/start', { method: 'POST', body: { subjectId: subject.id, method: selectedMethod } });
        lastPhase = null;
        renderStudyTab();
      } catch (e) {
        errBox.innerHTML = `<div class="add-error">${escapeHtml(e.message)}</div>`;
      }
    });
  }

  function studyRingSvg({ fracRemaining, phaseClass, spinForever, spinPaused }) {
    const r = 45;
    const c = 2 * Math.PI * r;
    let dasharray = c;
    let offset = c * (1 - fracRemaining);
    if (spinForever) {
      dasharray = `${c * 0.3} ${c * 0.7}`;
      offset = 0;
    }
    const spinCls = spinForever ? ` spin-forever${spinPaused ? ' spin-paused' : ''}` : '';
    return `
      <svg viewBox="0 0 100 100" class="study-ring">
        <circle cx="50" cy="50" r="${r}" class="study-ring-track" />
        <circle cx="50" cy="50" r="${r}" class="study-ring-progress${phaseClass ? ' ' + phaseClass : ''}${spinCls}"
          stroke-dasharray="${dasharray}" stroke-dashoffset="${offset}" />
      </svg>
    `;
  }

  function renderFocusView(active) {
    const body = document.getElementById('study-tab-body');
    const isPomo = active.method === 'pomodoro';
    let ring, timeText, subText, phaseBadge = '';
    if (isPomo) {
      const frac = active.phaseDurationMs ? Math.max(0, Math.min(1, active.phaseRemainingMs / active.phaseDurationMs)) : 0;
      ring = studyRingSvg({ fracRemaining: frac, phaseClass: active.phase === 'rest' ? 'rest' : '' });
      timeText = fmtClock(active.phaseRemainingMs);
      subText = active.phase === 'rest' ? 'left in this break' : 'left in this session';
      phaseBadge = `<div class="study-focus-phase${active.phase === 'rest' ? ' rest' : ''}">${active.phase === 'rest' ? '☕ Break' : '📖 Studying'}</div>`;
    } else {
      ring = studyRingSvg({ fracRemaining: 1, spinForever: active.running, spinPaused: !active.running });
      timeText = fmtClock(active.elapsedMs);
      subText = 'elapsed';
    }
    body.innerHTML = `
      <div class="study-focus">
        <div class="study-focus-subject">${escapeHtml(active.subjectName)}</div>
        ${phaseBadge}
        <div class="study-ring-wrap">
          ${ring}
          <div class="study-ring-center">
            <div class="study-ring-time">${timeText}</div>
            <div class="study-ring-sub">${subText}</div>
          </div>
        </div>
        ${isPomo ? `<div class="study-focus-cycles">${active.cyclesCompleted} full cycle${active.cyclesCompleted === 1 ? '' : 's'} completed · ${fmtHoursShort(active.studiedMs)} studied so far</div>` : ''}
        <div class="study-focus-actions">
          <button class="btn" id="study-pauseresume-btn">${active.running ? 'Pause' : 'Resume'}</button>
          <button class="btn" id="study-finish-btn">Stop &amp; Save</button>
          <button class="btn secondary" id="study-cancel-btn">Cancel (don't save)</button>
        </div>
      </div>
    `;
    document.getElementById('study-pauseresume-btn').addEventListener('click', async () => {
      try {
        await api(active.running ? '/api/study/active/pause' : '/api/study/active/resume', { method: 'POST' });
        pollFocus();
      } catch (e) { showToast(e.message); }
    });
    document.getElementById('study-finish-btn').addEventListener('click', async () => {
      if (pollTimer) clearInterval(pollTimer);
      try {
        const result = await api('/api/study/active/finish', { method: 'POST' });
        if (result.discarded) showToast("That was too short to save - discarded.");
        else showToast(`Saved ${fmtHoursShort(result.session.durationMs)} studied`);
      } catch (e) { showToast(e.message); }
      renderStudyTab();
    });
    document.getElementById('study-cancel-btn').addEventListener('click', async () => {
      if (!confirm('Discard this session without saving any time?')) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        await api('/api/study/active/cancel', { method: 'POST' });
        showToast('Session discarded');
      } catch (e) { showToast(e.message); }
      renderStudyTab();
    });
  }

  async function pollFocus() {
    let active;
    try {
      active = await api('/api/study/active');
    } catch (e) {
      return; // transient error - just try again next tick
    }
    if (!active) {
      if (pollTimer) clearInterval(pollTimer);
      renderStudyTab();
      return;
    }
    if (active.method === 'pomodoro' && lastPhase && active.phase !== lastPhase) {
      playPhaseBeep(active.phase === 'rest');
    }
    lastPhase = active.phase || null;
    renderFocusView(active);
  }

  // ================= STATS tab =================

  function buildPieSvg(subjectTotals, overallMs) {
    if (overallMs <= 0 || subjectTotals.length === 0) return '';
    const r = 52;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const segs = subjectTotals.map((st) => {
      const len = c * (st.totalMs / overallMs);
      const svg = `<circle cx="65" cy="65" r="${r}" fill="none" stroke="${colorForSubject(st.subjectId)}" stroke-width="24" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" />`;
      offset += len;
      return svg;
    }).join('');
    return `<svg viewBox="0 0 130 130" style="width:150px;height:150px;transform:rotate(-90deg)">${segs}</svg>`;
  }

  async function renderStatsTab() {
    const body = document.getElementById('study-tab-body');
    body.innerHTML = `<div class="empty-state">Loading…</div>`;
    let stats;
    try {
      stats = await api(`/api/study/stats?year=${statsYear}`);
    } catch (e) {
      body.innerHTML = `<div class="empty-state">Could not load: ${escapeHtml(e.message)}</div>`;
      return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    const isCurrentYear = statsYear === new Date().getFullYear();
    const todayEntry = stats.heatmap.find((d) => d.date === todayStr);
    const canQuickLog = isCurrentYear && todayEntry && !todayEntry.status;

    const maxSubjectMs = Math.max(1, ...stats.subjectTotals.map((s) => s.totalMs));

    body.innerHTML = `
      <div class="study-year-nav">
        <button id="study-stats-prev-year">◀</button>
        <span class="study-year-label">${statsYear}</span>
        <button id="study-stats-next-year">▶</button>
      </div>
      <div class="study-stat-summary">
        <div class="study-stat-tile"><div class="study-stat-tile-value">${fmtHoursShort(stats.overallMs)}</div><div class="study-stat-tile-label">Total studied</div></div>
        <div class="study-stat-tile"><div class="study-stat-tile-value">${stats.sessionCount}</div><div class="study-stat-tile-label">Sessions</div></div>
        <div class="study-stat-tile"><div class="study-stat-tile-value">${stats.dayCounts.studied}</div><div class="study-stat-tile-label">Days studied</div></div>
      </div>
      <div class="study-stats-cols">
        <div class="study-stats-col">
          <h3>Time by subject</h3>
          ${stats.subjectTotals.length === 0 ? `<div class="empty-state">No study time recorded yet in ${statsYear}.</div>` : `
            <div class="study-pie-wrap">
              ${buildPieSvg(stats.subjectTotals, stats.overallMs)}
              <div class="study-pie-legend">
                ${stats.subjectTotals.map((s) => `
                  <div class="study-pie-legend-row">
                    <span class="study-pie-swatch" style="background:${colorForSubject(s.subjectId)}"></span>
                    ${escapeHtml(s.name)} — ${fmtHoursShort(s.totalMs)}
                  </div>
                `).join('')}
              </div>
            </div>
            <div style="margin-top:18px">
              ${stats.subjectTotals.map((s) => `
                <div class="study-bar-row">
                  <div class="study-bar-label">${escapeHtml(s.name)}</div>
                  <div class="study-bar-track"><div class="study-bar-fill" style="width:${(s.totalMs / maxSubjectMs) * 100}%;background:${colorForSubject(s.subjectId)}"></div></div>
                  <div class="study-bar-value">${fmtHoursShort(s.totalMs)}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
        <div class="study-stats-col">
          <h3>Days this year</h3>
          <div class="study-daycounts">
            <div class="study-daycount"><span class="study-daycount-dot" style="background:var(--study-accent-dark)"></span>Studied: ${stats.dayCounts.studied}</div>
            <div class="study-daycount"><span class="study-daycount-dot" style="background:var(--study-slept)"></span>Slept: ${stats.dayCounts.slept}</div>
            <div class="study-daycount"><span class="study-daycount-dot" style="background:var(--study-nothing)"></span>Did nothing: ${stats.dayCounts.nothing}</div>
          </div>
          ${canQuickLog ? `
            <div class="study-quicklog panel">
              <div><strong>How was today so far?</strong></div>
              <div class="hint">You haven't logged any study time today - mark it as slept or as nothing, or just study something and this'll update itself.</div>
              <div class="study-quicklog-buttons">
                <button class="btn secondary" id="study-quicklog-slept">😴 Slept</button>
                <button class="btn secondary" id="study-quicklog-nothing">🚫 Did nothing</button>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    document.getElementById('study-stats-prev-year').addEventListener('click', () => { statsYear--; renderStatsTab(); });
    document.getElementById('study-stats-next-year').addEventListener('click', () => { statsYear++; renderStatsTab(); });
    if (canQuickLog) {
      document.getElementById('study-quicklog-slept').addEventListener('click', () => quickLog(todayStr, 'slept'));
      document.getElementById('study-quicklog-nothing').addEventListener('click', () => quickLog(todayStr, 'nothing'));
    }
  }

  async function quickLog(date, status) {
    try {
      await api(`/api/study/daylog/${date}`, { method: 'PUT', body: { status } });
      showToast('Logged');
      renderStatsTab();
    } catch (e) { showToast(e.message); }
  }

  // ================= CALENDAR tab (year heatmap) =================

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_ROW_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  function buildHeatmapCells(heatmapDays) {
    const first = new Date(`${heatmapDays[0].date}T00:00:00`);
    const startWeekday = first.getDay();
    return new Array(startWeekday).fill(null).concat(heatmapDays);
  }

  async function renderCalendarTab() {
    const body = document.getElementById('study-tab-body');
    body.innerHTML = `<div class="empty-state">Loading…</div>`;
    let stats;
    try {
      stats = await api(`/api/study/stats?year=${calendarYear}`);
    } catch (e) {
      body.innerHTML = `<div class="empty-state">Could not load: ${escapeHtml(e.message)}</div>`;
      return;
    }
    const cells = buildHeatmapCells(stats.heatmap);
    const todayStr = new Date().toISOString().slice(0, 10);
    const numCols = Math.ceil(cells.length / 7);

    const monthLabels = [];
    for (let col = 0; col < numCols; col++) {
      const dayEntry = cells[col * 7];
      let label = '';
      // Look at every day in this column - if any of them is the 1st of
      // a month, label this column with that month's name.
      for (let row = 0; row < 7; row++) {
        const entry = cells[col * 7 + row];
        if (entry && entry.date.slice(8, 10) === '01') {
          label = MONTH_NAMES[Number(entry.date.slice(5, 7)) - 1];
          break;
        }
      }
      monthLabels.push(label);
    }

    body.innerHTML = `
      <div class="study-year-nav">
        <button id="study-cal-prev-year">◀</button>
        <span class="study-year-label">${calendarYear}</span>
        <button id="study-cal-next-year">▶</button>
      </div>
      <div class="study-page-sub">Click any past day with no study session to mark it as slept or as nothing. Days you actually studied are colored automatically.</div>
      <div class="study-heatmap-scroll">
        <div class="study-heatmap-months">${monthLabels.map((l) => `<div>${l}</div>`).join('')}</div>
        <div class="study-heatmap-body">
          <div class="study-heatmap-daylabels">${DAY_ROW_LABELS.map((l) => `<div>${l}</div>`).join('')}</div>
          <div class="study-heatmap-grid" id="study-heatmap-grid">
            ${cells.map((entry) => {
              if (!entry) return `<div></div>`;
              const isFuture = entry.date > todayStr;
              const title = isFuture ? entry.date
                : entry.status === 'studied' ? `${entry.date}: studied ${entry.minutes}m`
                : entry.status === 'slept' ? `${entry.date}: slept`
                : entry.status === 'nothing' ? `${entry.date}: did nothing`
                : `${entry.date}: not logged`;
              return `<div class="study-heat-cell${isFuture ? ' future' : ''}" data-date="${entry.date}" data-level="${entry.level}" ${entry.status ? `data-status="${entry.status}"` : ''} title="${escapeHtml(title)}"></div>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="study-heatmap-legend">
        <div class="study-heatmap-legend-group">Less
          <span class="study-heat-cell" data-level="0"></span>
          <span class="study-heat-cell" data-level="1"></span>
          <span class="study-heat-cell" data-level="2"></span>
          <span class="study-heat-cell" data-level="3"></span>
          <span class="study-heat-cell" data-level="4"></span>
        More</div>
        <div class="study-heatmap-legend-group"><span class="study-heat-cell" data-status="slept"></span>Slept</div>
        <div class="study-heatmap-legend-group"><span class="study-heat-cell" data-status="nothing"></span>Did nothing</div>
      </div>
      <div id="study-daylog-panel"></div>
    `;
    document.getElementById('study-cal-prev-year').addEventListener('click', () => { calendarYear--; selectedDay = null; renderCalendarTab(); });
    document.getElementById('study-cal-next-year').addEventListener('click', () => { calendarYear++; selectedDay = null; renderCalendarTab(); });
    document.getElementById('study-heatmap-grid').querySelectorAll('.study-heat-cell').forEach((cell) => {
      if (cell.classList.contains('future') || !cell.dataset.date) return;
      cell.addEventListener('click', () => {
        selectedDay = stats.heatmap.find((d) => d.date === cell.dataset.date);
        renderDaylogPanel();
      });
    });
    renderDaylogPanel();
  }

  function renderDaylogPanel() {
    const panel = document.getElementById('study-daylog-panel');
    if (!selectedDay) { panel.innerHTML = ''; return; }
    const d = selectedDay;
    let body;
    if (d.status === 'studied') {
      body = `<div>You studied ${d.minutes} minute${d.minutes === 1 ? '' : 's'} on this day - that's automatic and can't be overwritten.</div>`;
    } else {
      body = `
        <div class="study-daylog-panel-buttons">
          <button class="btn secondary" data-status="slept">😴 Mark as slept</button>
          <button class="btn secondary" data-status="nothing">🚫 Mark as did nothing</button>
          ${d.status ? `<button class="btn secondary" data-status="">Clear mark</button>` : ''}
        </div>
      `;
    }
    panel.innerHTML = `
      <div class="study-daylog-panel">
        <div class="study-daylog-panel-title">${d.date}</div>
        ${body}
      </div>
    `;
    panel.querySelectorAll('button[data-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/study/daylog/${d.date}`, { method: 'PUT', body: { status: btn.dataset.status || null } });
          selectedDay = null;
          renderCalendarTab();
        } catch (e) { showToast(e.message); }
      });
    });
  }

  // ---------------- Entry point ----------------

  function render(subview) {
    if (pollTimer) clearInterval(pollTimer);
    const tab = TABS.some((t) => t.id === subview) ? subview : 'study';
    renderShell(tab);
    if (tab === 'study') return renderStudyTab();
    if (tab === 'stats') return renderStatsTab();
    if (tab === 'calendar') return renderCalendarTab();
  }

  window.Study = { render };

  // Self-register with app.js's generic subsystem dispatch, same
  // mechanism ytdownload.js uses (see lib/subsystems-registry.js).
  window.DexSubsystems = window.DexSubsystems || {};
  window.DexSubsystems['study'] = { render };
})();
