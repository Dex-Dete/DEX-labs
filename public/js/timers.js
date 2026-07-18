// Clock subsystem (id stays 'timers' - see lib/subsystems-registry.js
// for why the id is never renamed once shipped). Self-contained module,
// same isolation pattern as airdrop.js/schedule.js. Three menus live
// inside this one subsystem: Timer, Alarm, Stopwatch.
//
// Timer & Alarm are SERVER-authoritative (see lib/timers-store.js) - this
// page just reflects state rather than owning any countdown logic
// itself, because the loud alarm beep happens on the server machine
// regardless of whether this page is even open. Stopwatch (v1.1.1) is
// also server-backed (lib/stopwatch-store.js) so it survives a page
// reload/server restart correctly, but needs no beep/tick loop - it's
// pure elapsed-time math off stored timestamps.
(() => {
  const toastEl = document.getElementById('toast');
  let pollTimer = null;
  let audioCtx = null;
  let currentTab = 'timer';

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

  function fmtRemaining(ms) {
    if (ms <= 0) return "0:00";
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // mm:ss (or h:mm:ss past an hour) counting UP - same shape as
  // fmtRemaining but for elapsed time, so a stopwatch reads naturally.
  function fmtElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // A quick bonus beep IN THE BROWSER via Web Audio - handy if you're
  // actually looking at the page. The real, "loud through the system"
  // alarm is the server-side beep in lib/timers-store.js, which fires
  // regardless of whether anyone has this page open at all (and, as of
  // v1.1.1, is a real WAV played through the normal audio stack rather
  // than a raw console beep, so it reaches Bluetooth speakers/headsets
  // too - see the comment above ringServerBeep() in that file).
  function playBrowserBeep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.35; // v1.1.2: was 0.15 - too quiet to notice
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      setTimeout(() => osc.stop(), 250);
    } catch (e) { /* autoplay policies etc. - not critical, server beep is the real alarm */ }
  }

  // Shared ring markup for all 3 menus - Timer/Alarm draw a countdown
  // arc (fracRemaining shrinks to 0), Stopwatch draws a fixed arc that
  // spins continuously via CSS while running (spin=true) and freezes in
  // place when paused. Same visual language everywhere on purpose.
  function ringSvg({ fracRemaining = 1, ringing = false, spin = false, spinPaused = false }) {
    const r = 42;
    const c = 2 * Math.PI * r;
    let dasharray = c;
    let offset = c * (1 - fracRemaining);
    if (spin) {
      // A fixed ~30% arc that rotates via CSS instead of shrinking -
      // there's no "remaining" for a stopwatch to count down.
      dasharray = `${c * 0.3} ${c * 0.7}`;
      offset = 0;
    }
    const spinClasses = spin ? ` sw-spin${spinPaused ? ' sw-paused' : ''}` : '';
    return `
      <svg viewBox="0 0 100 100" class="timer-ring">
        <circle cx="50" cy="50" r="${r}" class="timer-ring-track" />
        <circle cx="50" cy="50" r="${r}" class="timer-ring-progress${ringing ? ' ringing' : ''}${spinClasses}"
          stroke-dasharray="${dasharray}" stroke-dashoffset="${offset}" />
      </svg>
    `;
  }

  // Builds a single DOM element from an HTML string (the string must
  // have exactly one root element).
  function elFromHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  // v1.1.2: shared list-reconciliation helper for the Timer/Alarm and
  // Stopwatch grids. Both used to fully replace `wrap.innerHTML` on
  // every 1s poll, which destroyed and recreated every card's DOM
  // node each time - including the ring's <circle>, so any CSS
  // animation running on it (the Stopwatch's continuous spin) got
  // reset to its 0% frame every single poll instead of running
  // uninterrupted. Since the poll interval (1s) is shorter than the
  // spin animation's duration (1.6s), the animation never got to
  // finish a lap - it visibly turned ~60-70% of the way around and
  // then snapped back to the start, over and over. This reconciler
  // keeps each card's DOM node alive across polls (so CSS animations
  // on it keep running) and only updates the parts of it that
  // actually changed, only building/removing nodes for cards that
  // were actually added/removed.
  //
  // - wrap: container element (the "…-list-wrap" div)
  // - items: latest array of records, each with a unique `.id`
  // - emptyMessage: shown when items is empty
  // - buildCard(item): returns a brand-new DOM element for a record
  //   not currently on screen
  // - updateCard(cardEl, item): mutates an existing card element's
  //   dynamic bits in place to match the latest data
  function reconcileGrid(wrap, items, emptyMessage, buildCard, updateCard) {
    if (!wrap) return;
    if (items.length === 0) {
      wrap.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
      return;
    }
    let grid = wrap.querySelector(':scope > .timers-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'timers-grid';
      wrap.innerHTML = '';
      wrap.appendChild(grid);
    }
    const seenIds = new Set();
    for (const item of items) {
      const id = String(item.id);
      seenIds.add(id);
      const existing = grid.querySelector(`:scope > [data-id="${id}"]`);
      if (existing) {
        updateCard(existing, item);
      } else {
        grid.appendChild(buildCard(item));
      }
    }
    grid.querySelectorAll(':scope > [data-id]').forEach((cardEl) => {
      if (!seenIds.has(cardEl.dataset.id)) cardEl.remove();
    });
  }

  // ---------------- Tab menu shell ----------------

  const TABS = [
    { id: 'timer', label: '⏱ Timer' },
    { id: 'alarm', label: '🔔 Alarm' },
    { id: 'stopwatch', label: '⏲ Stopwatch' },
  ];

  function renderShell(tab) {
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = `<span>Clock</span><span> / </span><span>${escapeHtml(TABS.find((t) => t.id === tab).label.replace(/^\S+\s/, ''))}</span>`;
    const view = document.getElementById('view');
    view.innerHTML = `
      <h1 class="page-title">Clock</h1>
      <div class="clock-tabs" id="clock-tabs">
        ${TABS.map((t) => `<button class="clock-tab-btn${t.id === tab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div id="clock-tab-body"></div>
    `;
    document.querySelectorAll('.clock-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        location.hash = target === 'timer' ? '#/timers' : `#/timers/${target}`;
      });
    });
  }

  // ---------------- Timer & Alarm (shared logic, one kind each) ----------------

  function wireTimerCardButtons(cardEl) {
    const dismissBtn = cardEl.querySelector('.timer-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', async () => {
        await api(`/api/timers/${cardEl.dataset.id}/dismiss`, { method: 'POST' });
        poll();
      });
    }
    const cancelBtn = cardEl.querySelector('.timer-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        await api(`/api/timers/${cardEl.dataset.id}`, { method: 'DELETE' });
        poll();
      });
    }
  }

  function buildTimerCard(t) {
    const frac = t.durationMs ? Math.max(0, Math.min(1, t.msRemaining / t.durationMs)) : 0;
    const ringing = t.status === 'ringing';
    const cardEl = elFromHtml(`
      <div class="timer-card${ringing ? ' ringing' : ''}" data-id="${t.id}">
        ${ringSvg({ fracRemaining: frac, ringing })}
        <div class="timer-card-inner">
          <div class="timer-remaining">${ringing ? '⏰' : fmtRemaining(t.msRemaining)}</div>
        </div>
        <div class="timer-label">${escapeHtml(t.label)}</div>
        ${ringing
          ? `<button class="btn timer-dismiss-btn" data-id="${t.id}">Dismiss</button>`
          : `<button class="del-btn timer-cancel-btn" data-id="${t.id}" title="Cancel">✕</button>`}
      </div>
    `);
    wireTimerCardButtons(cardEl);
    return cardEl;
  }

  function updateTimerCard(cardEl, t) {
    const frac = t.durationMs ? Math.max(0, Math.min(1, t.msRemaining / t.durationMs)) : 0;
    const ringing = t.status === 'ringing';
    const wasRinging = cardEl.classList.contains('ringing');
    cardEl.classList.toggle('ringing', ringing);

    const r = 42;
    const c = 2 * Math.PI * r;
    const ring = cardEl.querySelector('.timer-ring-progress');
    ring.setAttribute('stroke-dasharray', c);
    ring.setAttribute('stroke-dashoffset', c * (1 - frac));
    ring.classList.toggle('ringing', ringing);

    cardEl.querySelector('.timer-remaining').textContent = ringing ? '⏰' : fmtRemaining(t.msRemaining);
    cardEl.querySelector('.timer-label').textContent = t.label;

    // The dismiss/cancel button only needs rebuilding when the
    // ringing state actually flips - avoids re-wiring a click handler
    // every single poll for the common case (nothing changed).
    if (ringing !== wasRinging) {
      const oldBtn = cardEl.querySelector('.timer-dismiss-btn, .timer-cancel-btn');
      const newBtn = elFromHtml(ringing
        ? `<button class="btn timer-dismiss-btn" data-id="${t.id}">Dismiss</button>`
        : `<button class="del-btn timer-cancel-btn" data-id="${t.id}" title="Cancel">✕</button>`);
      oldBtn.replaceWith(newBtn);
      wireTimerCardButtons(cardEl);
    }
  }

  function renderTimerOrAlarmCards(timers, kind) {
    const wrap = document.getElementById('timers-list-wrap');
    const filtered = timers.filter((t) => t.kind === kind);
    reconcileGrid(
      wrap,
      filtered,
      `No ${kind === 'alarm' ? 'alarms' : 'timers'} running. Add one above.`,
      buildTimerCard,
      updateTimerCard
    );
  }

  function renderTimerOrAlarmForm(kind) {
    const isAlarm = kind === 'alarm';
    return `
      <div class="panel">
        <div class="timers-form-row">
          <input type="text" id="timer-label" placeholder="Label (e.g. ${isAlarm ? 'Wake up' : 'Pomodoro, Study break'})" maxlength="60" />
          ${isAlarm
            ? `<input type="time" id="timer-alarm-time" class="timer-alarm-time" />`
            : `<div id="timer-duration-fields" class="timer-duration-fields">
                <input type="number" id="timer-h" min="0" max="23" placeholder="hh" />
                <input type="number" id="timer-m" min="0" max="59" placeholder="mm" />
                <input type="number" id="timer-s" min="0" max="59" placeholder="ss" />
              </div>`}
          <button class="btn" id="timer-add-btn">Start</button>
        </div>
        <div id="timer-add-error"></div>
      </div>
      <div id="timers-list-wrap"><div class="empty-state">Loading…</div></div>
    `;
  }

  function wireTimerOrAlarmForm(kind) {
    document.getElementById('timer-add-btn').addEventListener('click', async () => {
      const label = document.getElementById('timer-label').value.trim();
      const errorBox = document.getElementById('timer-add-error');
      errorBox.innerHTML = '';
      const body = { label, kind };
      if (kind === 'alarm') {
        const t = document.getElementById('timer-alarm-time').value;
        if (!t) { errorBox.innerHTML = `<div class="add-error">Pick a time for the alarm.</div>`; return; }
        body.targetTime = t;
      } else {
        const h = Number(document.getElementById('timer-h').value) || 0;
        const m = Number(document.getElementById('timer-m').value) || 0;
        const s = Number(document.getElementById('timer-s').value) || 0;
        const durationMs = (h * 3600 + m * 60 + s) * 1000;
        if (durationMs <= 0) { errorBox.innerHTML = `<div class="add-error">Enter a duration greater than zero.</div>`; return; }
        body.durationMs = durationMs;
      }
      try {
        await api('/api/timers', { method: 'POST', body });
        document.getElementById('timer-label').value = '';
        showToast('Started');
        poll();
      } catch (e) {
        errorBox.innerHTML = `<div class="add-error">${escapeHtml(e.message)}</div>`;
      }
    });
  }

  let lastRingingIds = new Set();
  async function poll() {
    try {
      const timers = await api('/api/timers');
      renderTimerOrAlarmCards(timers, currentTab);
      const nowRinging = new Set(timers.filter((t) => t.status === 'ringing').map((t) => t.id));
      // Only beep in-browser on the transition into ringing, not every poll.
      for (const id of nowRinging) {
        if (!lastRingingIds.has(id)) playBrowserBeep();
      }
      lastRingingIds = nowRinging;
    } catch (e) {
      const wrap = document.getElementById('timers-list-wrap');
      if (wrap) wrap.innerHTML = `<div class="empty-state">Could not load timers: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderTimerTab(kind) {
    const body = document.getElementById('clock-tab-body');
    const subLabel = kind === 'alarm' ? 'alarms' : 'timers';
    body.innerHTML = `
      <div class="timers-page-sub">Up to 10 ${subLabel} at once. When one goes off, this machine (the server) beeps loudly through its own speakers - not just this browser tab.</div>
      ${renderTimerOrAlarmForm(kind)}
    `;
    wireTimerOrAlarmForm(kind);
    poll();
    pollTimer = setInterval(poll, 1000);
  }

  // ---------------- Stopwatch ----------------

  function lapsHtml(t) {
    return t.laps.length
      ? `<div class="sw-laps">${t.laps.slice().reverse().map((l, i) => `
          <div class="sw-lap-row"><span>Lap ${t.laps.length - i}</span><span>${fmtElapsed(l.ms)}</span></div>
        `).join('')}</div>`
      : '';
  }

  function wireStopwatchCardButtons(cardEl) {
    const pauseBtn = cardEl.querySelector('.sw-pause-btn');
    if (pauseBtn) pauseBtn.addEventListener('click', async () => {
      await api(`/api/timers/stopwatches/${cardEl.dataset.id}/pause`, { method: 'POST' });
      swPoll();
    });
    const resumeBtn = cardEl.querySelector('.sw-resume-btn');
    if (resumeBtn) resumeBtn.addEventListener('click', async () => {
      await api(`/api/timers/stopwatches/${cardEl.dataset.id}/resume`, { method: 'POST' });
      swPoll();
    });
    cardEl.querySelector('.sw-lap-btn').addEventListener('click', async () => {
      await api(`/api/timers/stopwatches/${cardEl.dataset.id}/lap`, { method: 'POST' });
      swPoll();
    });
    cardEl.querySelector('.sw-reset-btn').addEventListener('click', async () => {
      await api(`/api/timers/stopwatches/${cardEl.dataset.id}/reset`, { method: 'POST' });
      swPoll();
    });
    cardEl.querySelector('.sw-remove-btn').addEventListener('click', async () => {
      await api(`/api/timers/stopwatches/${cardEl.dataset.id}`, { method: 'DELETE' });
      swPoll();
    });
  }

  function buildStopwatchCard(t) {
    const cardEl = elFromHtml(`
      <div class="timer-card${t.running ? ' sw-running' : ''}" data-id="${t.id}">
        ${ringSvg({ spin: true, spinPaused: !t.running })}
        <div class="timer-card-inner">
          <div class="timer-remaining">${fmtElapsed(t.elapsedMs)}</div>
        </div>
        <div class="timer-label">${escapeHtml(t.label)}</div>
        <div class="sw-actions">
          ${t.running
            ? `<button class="btn secondary sw-pause-btn" data-id="${t.id}">Pause</button>`
            : `<button class="btn secondary sw-resume-btn" data-id="${t.id}">Resume</button>`}
          <button class="btn secondary sw-lap-btn" data-id="${t.id}">Lap</button>
          <button class="btn secondary sw-reset-btn" data-id="${t.id}">Reset</button>
          <button class="del-btn sw-remove-btn" data-id="${t.id}" title="Remove">✕</button>
        </div>
        ${lapsHtml(t)}
      </div>
    `);
    wireStopwatchCardButtons(cardEl);
    return cardEl;
  }

  // v1.1.2: this is the actual fix for the "spins ~70% then snaps
  // back" bug - the ring's <circle> (and its CSS sw-ring-spin
  // animation, see timers.css) is never destroyed/recreated on a
  // normal poll anymore, so the animation just keeps running
  // uninterrupted like a real spinner instead of restarting from 0%
  // every second. Only the running/paused state toggles a class.
  function updateStopwatchCard(cardEl, t) {
    const wasRunning = cardEl.classList.contains('sw-running');
    cardEl.classList.toggle('sw-running', t.running);
    cardEl.querySelector('.timer-ring-progress').classList.toggle('sw-paused', !t.running);
    cardEl.querySelector('.timer-remaining').textContent = fmtElapsed(t.elapsedMs);
    cardEl.querySelector('.timer-label').textContent = t.label;

    if (t.running !== wasRunning) {
      const oldBtn = cardEl.querySelector('.sw-pause-btn, .sw-resume-btn');
      const newBtn = elFromHtml(t.running
        ? `<button class="btn secondary sw-pause-btn" data-id="${t.id}">Pause</button>`
        : `<button class="btn secondary sw-resume-btn" data-id="${t.id}">Resume</button>`);
      oldBtn.replaceWith(newBtn);
      if (t.running) {
        newBtn.addEventListener('click', async () => {
          await api(`/api/timers/stopwatches/${cardEl.dataset.id}/pause`, { method: 'POST' });
          swPoll();
        });
      } else {
        newBtn.addEventListener('click', async () => {
          await api(`/api/timers/stopwatches/${cardEl.dataset.id}/resume`, { method: 'POST' });
          swPoll();
        });
      }
    }

    // Laps only ever grow while a given stopwatch card is on screen -
    // cheap to just re-render this one sub-section on count change.
    const existingLaps = cardEl.querySelector('.sw-laps');
    const existingCount = existingLaps ? existingLaps.querySelectorAll('.sw-lap-row').length : 0;
    if (t.laps.length !== existingCount) {
      const newLapsEl = lapsHtml(t) ? elFromHtml(lapsHtml(t)) : null;
      if (existingLaps) existingLaps.remove();
      if (newLapsEl) cardEl.appendChild(newLapsEl);
    }
  }

  function renderStopwatchCards(stopwatches) {
    const wrap = document.getElementById('sw-list-wrap');
    reconcileGrid(
      wrap,
      stopwatches,
      'No stopwatches yet. Start one above.',
      buildStopwatchCard,
      updateStopwatchCard
    );
  }

  async function swPoll() {
    try {
      const stopwatches = await api('/api/timers/stopwatches');
      renderStopwatchCards(stopwatches);
    } catch (e) {
      const wrap = document.getElementById('sw-list-wrap');
      if (wrap) wrap.innerHTML = `<div class="empty-state">Could not load stopwatches: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderStopwatchTab() {
    const body = document.getElementById('clock-tab-body');
    body.innerHTML = `
      <div class="timers-page-sub">Up to 10 stopwatches at once. These run on the server too, so they keep correct time even if you switch tabs, close the browser, or the server restarts.</div>
      <div class="panel">
        <div class="timers-form-row">
          <input type="text" id="sw-label" placeholder="Label (e.g. Cardio, Chess clock)" maxlength="60" />
          <button class="btn" id="sw-add-btn">Start</button>
        </div>
        <div id="sw-add-error"></div>
      </div>
      <div id="sw-list-wrap"><div class="empty-state">Loading…</div></div>
    `;
    document.getElementById('sw-add-btn').addEventListener('click', async () => {
      const label = document.getElementById('sw-label').value.trim();
      const errorBox = document.getElementById('sw-add-error');
      errorBox.innerHTML = '';
      try {
        await api('/api/timers/stopwatches', { method: 'POST', body: { label } });
        document.getElementById('sw-label').value = '';
        showToast('Started');
        swPoll();
      } catch (e) {
        errorBox.innerHTML = `<div class="add-error">${escapeHtml(e.message)}</div>`;
      }
    });
    swPoll();
    pollTimer = setInterval(swPoll, 1000);
  }

  // ---------------- Entry point ----------------

  function render(subview) {
    if (pollTimer) clearInterval(pollTimer);
    lastRingingIds = new Set();
    const tab = TABS.some((t) => t.id === subview) ? subview : 'timer';
    currentTab = tab;

    renderShell(tab);
    if (tab === 'timer') return renderTimerTab('timer');
    if (tab === 'alarm') return renderTimerTab('alarm');
    if (tab === 'stopwatch') return renderStopwatchTab();
  }

  window.Timers = { render };
})();
