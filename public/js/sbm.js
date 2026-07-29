// Standby Mode (SBM) - v1.3.0's new subsystem. Registered as an
// ordinary subsystem tab (confirmed with the user, not a separate
// full-screen "mode") - uses the generic window.DexSubsystems fallback
// in app.js's route(), same as ytdownload.js. See
// lib/subsystems-registry.js for the registry entry.
//
// Deliberately reads its live data from the SAME endpoints their owning
// subsystems already use (Study's /api/study/active + /rec/active,
// Events' /api/events/upcoming) rather than duplicating any of that
// logic here - the brief was explicit that the live clock has to mirror
// the real running session/timer, not be a second independent one.
(() => {
  const toastEl = document.getElementById('toast');
  let pollHandles = [];
  let creature = null;

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

  function fmtHMS(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h > 0 ? h + ':' : ''}${h > 0 ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
  }

  function stopAllPolling() {
    pollHandles.forEach((h) => clearInterval(h));
    pollHandles = [];
    if (creature) { creature.destroy(); creature = null; }
  }

  // ---------------- Big clock (top of SBM) ----------------
  // Uses this device's own local time (it's what's actually on-screen
  // for whoever's looking at it) rather than round-tripping to the
  // server every second. Format (12h/24h) is SBM-only per the brief -
  // confirmed with the user as NOT a global setting.
  function renderClockTick(clockFormat) {
    const now = new Date();
    let h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();
    let ampm = '';
    if (clockFormat === '12') {
      ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
    }
    const hhEl = document.getElementById('sbm-clock-hh');
    const mmEl = document.getElementById('sbm-clock-mm');
    const ssEl = document.getElementById('sbm-clock-ss');
    const ampmEl = document.getElementById('sbm-clock-ampm');
    if (!hhEl) return; // navigated away
    hhEl.textContent = String(h).padStart(2, '0');
    mmEl.textContent = String(m).padStart(2, '0');
    const secStr = String(s).padStart(2, '0');
    if (ssEl.textContent !== secStr) {
      ssEl.textContent = secStr;
      // Animate on change rather than a hard cut - see sbm.css
      // .sbm-clock-ss.tick for the keyframe.
      ssEl.classList.remove('tick');
      // Force reflow so re-adding the class re-triggers the animation.
      void ssEl.offsetWidth;
      ssEl.classList.add('tick');
    }
    if (ampmEl) ampmEl.textContent = ampm;
  }

  // ---------------- Live Study/Rec clock mirror ----------------
  // Absent entirely (no placeholder) when nothing is running - only
  // shows a section at all once Study or Rec actually has an active
  // session, mirroring pause/resume/stop through the real
  // /api/study/... endpoints so it's the same session, not a second
  // timer racing alongside it.
  async function pollLiveSession() {
    const wrap = document.getElementById('sbm-live-session');
    if (!wrap) return;
    let studySession = null;
    let recSession = null;
    try { studySession = await api('/api/study/active'); } catch (e) { /* ignore */ }
    try { recSession = await api('/api/study/rec/active'); } catch (e) { /* ignore */ }

    const session = studySession || recSession;
    const isRec = !studySession && !!recSession;

    if (!session) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }
    wrap.style.display = '';
    const base = isRec ? '/api/study/rec/active' : '/api/study/active';
    const label = isRec ? 'Rec' : 'Study';
    wrap.innerHTML = `
      <div class="sbm-live-label">${label} - ${escapeHtml(session.subjectName)}</div>
      <div class="sbm-live-time">${fmtHMS(session.elapsedMs)}</div>
      <div class="sbm-live-actions">
        ${session.running
          ? `<button class="btn sbm-live-btn" id="sbm-live-pause">Pause</button>`
          : `<button class="btn sbm-live-btn" id="sbm-live-resume">Resume</button>`}
        <button class="btn sbm-live-btn sbm-live-stop" id="sbm-live-stop">Finish</button>
      </div>
    `;
    const pauseBtn = document.getElementById('sbm-live-pause');
    const resumeBtn = document.getElementById('sbm-live-resume');
    const stopBtn = document.getElementById('sbm-live-stop');
    if (pauseBtn) pauseBtn.addEventListener('click', async () => {
      try { await api(`${base}/pause`, { method: 'POST' }); pollLiveSession(); } catch (e) { showToast(e.message); }
    });
    if (resumeBtn) resumeBtn.addEventListener('click', async () => {
      try { await api(`${base}/resume`, { method: 'POST' }); pollLiveSession(); } catch (e) { showToast(e.message); }
    });
    if (stopBtn) stopBtn.addEventListener('click', async () => {
      try { await api(`${base}/finish`, { method: 'POST' }); pollLiveSession(); } catch (e) { showToast(e.message); }
    });
  }

  // ---------------- Events section ----------------
  async function loadEvents() {
    const el = document.getElementById('sbm-events');
    if (!el) return;
    try {
      const upcoming = await window.DexEvents.fetchUpcoming();
      if (!upcoming.length) { el.innerHTML = ''; return; }
      el.innerHTML = `
        <div class="sbm-section-title">Upcoming</div>
        <div class="sbm-events-list">
          ${upcoming.map((ev) => `
            <div class="sbm-event-row">
              <span>${escapeHtml(ev.name)}</span>
              <span class="sbm-event-remaining">${escapeHtml(window.DexEvents.formatRemaining(window.DexEvents.daysUntil(ev.targetDate)))}</span>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) { /* not critical */ }
  }

  // ---------------- Host stats section ----------------
  async function loadStats() {
    const el = document.getElementById('sbm-stats');
    if (!el) return;
    try {
      const stats = await api('/api/sbm/stats');
      el.innerHTML = `
        <div class="sbm-section-title">This machine</div>
        <div class="sbm-stat-row"><span>RAM</span><span>${stats.ram.usedPercent}%</span></div>
        <div class="sbm-stat-bar"><div class="sbm-stat-bar-fill" style="width:${stats.ram.usedPercent}%"></div></div>
        <div class="sbm-stat-row"><span>CPU</span><span>${stats.cpu.usedPercent}%</span></div>
        <div class="sbm-stat-bar"><div class="sbm-stat-bar-fill" style="width:${stats.cpu.usedPercent}%"></div></div>
      `;
    } catch (e) { el.innerHTML = ''; }
  }

  // ---------------- Science fact section ----------------
  let lastFactText = null;
  async function loadFact() {
    const el = document.getElementById('sbm-fact');
    if (!el) return;
    try {
      const fact = await api('/api/sbm/fact');
      if (fact.text === lastFactText) return;
      lastFactText = fact.text;
      el.innerHTML = `<div class="sbm-section-title">Did you know?</div><div class="sbm-fact-text">${escapeHtml(fact.text)}</div>`;
    } catch (e) { /* not critical */ }
  }

  // ---------------- Follow-mouse creature ----------------
  // v1.3.0 scope confirmed with the user: Standby Mode only (built so a
  // future release can reuse this for other subsystems - see the
  // self-contained `makeCreature()` factory below, which only needs a
  // container element - but only wired up here for now). PC/desktop
  // pointer only. Only actually shows when dark mode + ultra graphics
  // are BOTH on, on top of its own enable/disable setting. Idle
  // behavior: retreats to the nearest corner and hides a few seconds
  // after the mouse stops moving, and comes back out the moment the
  // mouse moves again.
  const LEG_COUNT = 30;
  const IDLE_MS = 2500;

  function makeCreature(container, sizeScale) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const root = document.createElementNS(svgNS, 'svg');
    const baseSize = 26 + sizeScale * 6; // sizeScale 1-10 -> ~32-86px body
    root.setAttribute('class', 'sbm-creature');
    root.setAttribute('viewBox', '-60 -60 120 120');
    root.style.width = `${baseSize * 2}px`;
    root.style.height = `${baseSize * 2}px`;

    const legsPerSide = LEG_COUNT / 2;
    const legEls = [];
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      for (let i = 0; i < legsPerSide; i++) {
        const t = i / (legsPerSide - 1); // 0..1 along the body
        const y = -18 + t * 36;
        const leg = document.createElementNS(svgNS, 'path');
        leg.setAttribute('class', 'sbm-creature-leg');
        leg.setAttribute('stroke-linecap', 'round');
        leg.style.animationDelay = `${(i % 5) * 0.08 + side * 0.15}s`;
        leg.dataset.y = y;
        leg.dataset.sign = sign;
        root.appendChild(leg);
        legEls.push(leg);
      }
    }
    const body = document.createElementNS(svgNS, 'ellipse');
    body.setAttribute('class', 'sbm-creature-body');
    body.setAttribute('rx', '20');
    body.setAttribute('ry', '11');
    root.appendChild(body);
    const eyeL = document.createElementNS(svgNS, 'circle');
    eyeL.setAttribute('class', 'sbm-creature-eye');
    eyeL.setAttribute('cx', '10'); eyeL.setAttribute('cy', '-4'); eyeL.setAttribute('r', '2.2');
    const eyeR = document.createElementNS(svgNS, 'circle');
    eyeR.setAttribute('class', 'sbm-creature-eye');
    eyeR.setAttribute('cx', '10'); eyeR.setAttribute('cy', '4'); eyeR.setAttribute('r', '2.2');
    root.appendChild(eyeL);
    root.appendChild(eyeR);

    function drawLegs() {
      legEls.forEach((leg) => {
        const y = Number(leg.dataset.y);
        const sign = Number(leg.dataset.sign);
        const footY = y + sign * 26;
        leg.setAttribute('d', `M0,${y} Q${sign * 14},${y + sign * 14} ${sign * 6},${footY}`);
      });
    }
    drawLegs();

    container.appendChild(root);

    let x = container.clientWidth / 2;
    let y = container.clientHeight / 2;
    let targetX = x;
    let targetY = y;
    let idleTimer = null;
    let idle = false;
    let rafId = null;
    let destroyed = false;

    function nearestCorner() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const corners = [[0, 0], [w, 0], [0, h], [w, h]];
      let best = corners[0];
      let bestDist = Infinity;
      corners.forEach(([cx, cy]) => {
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < bestDist) { bestDist = d; best = [cx, cy]; }
      });
      return best;
    }

    function onMove(e) {
      const rect = container.getBoundingClientRect();
      targetX = e.clientX - rect.left;
      targetY = e.clientY - rect.top;
      if (idle) { idle = false; root.classList.remove('sbm-creature-idle'); }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idle = true;
        root.classList.add('sbm-creature-idle');
        const [cx, cy] = nearestCorner();
        targetX = cx; targetY = cy;
      }, IDLE_MS);
    }
    container.addEventListener('mousemove', onMove);

    function tick() {
      if (destroyed) return;
      // Simple lerp for smooth following, with a soft edge steer so it
      // stays inside the container instead of clipping through the
      // sides (the brief's "steer around/avoid the edges").
      const margin = baseSize * 0.6;
      const w = container.clientWidth;
      const h = container.clientHeight;
      let tx = targetX;
      let ty = targetY;
      tx = Math.max(margin, Math.min(w - margin, tx));
      ty = Math.max(margin, Math.min(h - margin, ty));

      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;

      const angle = Math.atan2(ty - y, tx - x) * (180 / Math.PI);
      root.style.transform = `translate(${x - baseSize}px, ${y - baseSize}px) rotate(${angle}deg) scale(${idle ? 0.7 : 1})`;
      root.style.opacity = idle ? '0.35' : '1';

      rafId = requestAnimationFrame(tick);
    }
    tick();

    // Start centered and idle (hidden-ish) until the mouse actually
    // moves - matches "shows when moving mouse... hides when user stops".
    idle = true;
    root.classList.add('sbm-creature-idle');
    const [cx0, cy0] = nearestCorner();
    targetX = cx0; targetY = cy0;

    return {
      destroy() {
        destroyed = true;
        clearTimeout(idleTimer);
        if (rafId) cancelAnimationFrame(rafId);
        container.removeEventListener('mousemove', onMove);
        root.remove();
      },
    };
  }

  function isDesktopPointer() {
    return window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  }

  async function maybeSetupCreature(sbmSettings) {
    const container = document.getElementById('sbm-creature-container');
    if (!container) return;
    const dark = window.DexTheme && window.DexTheme.getEffective() === 'dark';
    const shouldShow = dark && sbmSettings.sbmUltraGraphics && sbmSettings.sbmCreatureEnabled && isDesktopPointer();
    if (creature) { creature.destroy(); creature = null; }
    if (shouldShow) creature = makeCreature(container, sbmSettings.sbmCreatureSize);
  }

  // ---------------- Entry point ----------------

  async function render() {
    stopAllPolling();
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = `<span>Standby Mode</span>`;
    const view = document.getElementById('view');

    let sbmSettings = { sbmStatsEnabled: true, sbmClockFormat: '24', sbmUltraGraphics: false, sbmCreatureEnabled: true, sbmCreatureSize: 5 };
    try { sbmSettings = await api('/api/settings/sbm'); } catch (e) { /* use defaults */ }

    view.innerHTML = `
      <div class="sbm-root${sbmSettings.sbmUltraGraphics ? ' sbm-ultra' : ''}" id="sbm-creature-container">
        <div class="sbm-clock-wrap">
          <div class="sbm-clock" id="sbm-clock">
            <span id="sbm-clock-hh">00</span>:<span id="sbm-clock-mm">00</span>:<span id="sbm-clock-ss" class="sbm-clock-ss">00</span>
            <span class="sbm-clock-ampm" id="sbm-clock-ampm"></span>
          </div>
        </div>
        <div id="sbm-live-session" class="sbm-live-session" style="display:none"></div>
        <div class="sbm-grid">
          <div class="sbm-card" id="sbm-events"></div>
          ${sbmSettings.sbmStatsEnabled ? '<div class="sbm-card" id="sbm-stats"></div>' : ''}
          <div class="sbm-card" id="sbm-fact"></div>
        </div>
      </div>
    `;

    renderClockTick(sbmSettings.sbmClockFormat);
    pollHandles.push(setInterval(() => renderClockTick(sbmSettings.sbmClockFormat), 1000));

    pollLiveSession();
    pollHandles.push(setInterval(pollLiveSession, 2000));

    loadEvents();
    pollHandles.push(setInterval(loadEvents, 60000));

    if (sbmSettings.sbmStatsEnabled) {
      loadStats();
      pollHandles.push(setInterval(loadStats, 3000));
    }

    loadFact();
    pollHandles.push(setInterval(loadFact, 5 * 60 * 1000));

    maybeSetupCreature(sbmSettings);
  }

  window.SBM = { render };
  window.DexSubsystems = window.DexSubsystems || {};
  window.DexSubsystems['sbm'] = { render, cleanup: stopAllPolling };
})();
