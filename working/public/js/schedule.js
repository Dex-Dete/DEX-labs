// Daily Schedule: a self-contained module, same pattern as airdrop.js -
// doesn't share code with Lesson Tracker or AirDrop beyond the page
// shell (topbar/toast already in index.html). A static 3-day grid of
// subjects that stays put until the user deliberately edits and saves
// it again - no dates, no rotation, no calendar logic.
(() => {
  const toastEl = document.getElementById('toast');

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

  function viewModeHtml(days, updatedAt) {
    const rows = days.map((day, i) => `
      <div class="schedule-row">
        <div class="schedule-day-label">Day ${i + 1}</div>
        <div class="schedule-slots">
          ${day.map((subj) => `<div class="schedule-slot${subj ? '' : ' empty'}">${subj ? escapeHtml(subj) : '—'}</div>`).join('')}
        </div>
      </div>
    `).join('');
    const savedNote = updatedAt
      ? `Last saved ${new Date(updatedAt).toLocaleString()}`
      : 'Not set up yet - click Edit to add your subjects.';
    return `
      <div class="schedule-grid">${rows}</div>
      <div class="schedule-meta">
        <span>${escapeHtml(savedNote)}</span>
        <button class="btn" id="schedule-edit-btn">Edit</button>
      </div>
    `;
  }

  function editModeHtml(days) {
    const rows = days.map((day, i) => `
      <div class="schedule-row">
        <div class="schedule-day-label">Day ${i + 1}</div>
        <div class="schedule-slots">
          ${day.map((subj, j) => `<input class="schedule-input" data-day="${i}" data-slot="${j}" value="${escapeHtml(subj)}" placeholder="Subject ${j + 1}" maxlength="100" />`).join('')}
        </div>
      </div>
    `).join('');
    return `
      <div class="schedule-grid editing">${rows}</div>
      <div class="schedule-meta">
        <span class="hint">Fill in up to 3 subjects per day. This stays exactly as saved until you edit it again.</span>
        <div>
          <button class="btn secondary" id="schedule-cancel-btn">Cancel</button>
          <button class="btn" id="schedule-save-btn">Save</button>
        </div>
      </div>
    `;
  }

  async function render() {
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = '<span>Daily Schedule</span>';
    const view = document.getElementById('view');
    view.innerHTML = `
      <h1 class="page-title">Daily Schedule</h1>
      <div class="schedule-page-sub">What to study on Day 1, Day 2, and Day 3 - up to 3 subjects each. Independent of Lesson Tracker's subject list; just plain text you fill in yourself.</div>
      <div class="panel" id="schedule-panel"><div class="empty-state">Loading…</div></div>
    `;

    let current;
    try {
      current = await api('/api/schedule');
    } catch (e) {
      document.getElementById('schedule-panel').innerHTML = `<div class="empty-state">Could not load schedule: ${escapeHtml(e.message)}</div>`;
      return;
    }

    function showView() {
      document.getElementById('schedule-panel').innerHTML = viewModeHtml(current.days, current.updatedAt);
      document.getElementById('schedule-edit-btn').addEventListener('click', showEdit);
    }

    function showEdit() {
      document.getElementById('schedule-panel').innerHTML = editModeHtml(current.days);
      document.getElementById('schedule-cancel-btn').addEventListener('click', showView);
      document.getElementById('schedule-save-btn').addEventListener('click', async () => {
        const inputs = document.querySelectorAll('.schedule-input');
        const days = [['', '', ''], ['', '', ''], ['', '', '']];
        inputs.forEach((inp) => {
          const d = Number(inp.dataset.day);
          const s = Number(inp.dataset.slot);
          days[d][s] = inp.value.trim();
        });
        try {
          current = await api('/api/schedule', { method: 'PUT', body: { days } });
          showToast('Schedule saved');
          showView();
        } catch (e) {
          showToast(e.message);
        }
      });
    }

    showView();
  }

  window.Schedule = { render };
})();
