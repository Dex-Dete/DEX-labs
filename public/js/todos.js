// To-Do subsystem - v1.4.0. Registered as an ordinary subsystem tab
// (lib/subsystems-registry.js id 'todos'), uses the generic
// window.DexSubsystems fallback in app.js's route(), same as sbm.js/
// ytdownload.js. Fully self-contained: own api/toast helpers, own
// state, no references to other subsystems' code.
//
// The brief's core asks, all in one page:
//   - a list you can tick off (like the GitHub-style "- [ ]" checkboxes
//     the user pasted - ticked items move to a "Done" section stamped
//     with today's date so the Calendar tab can show "what I did that
//     day");
//   - EASY add and delete (one input + Enter, one ✕ per row);
//   - scheduling: every item can carry a due date, and the Calendar
//     tab's day panel + bottom form schedule/edit the same items.
//
// Server-authoritative like everything else: all state lives in
// data/todos.json via routes/todos.js - this page just renders it and
// calls the API. Polls lightly (30s) so a to-do ticked on another
// device/another tab shows up without a reload.
(() => {
  const toastEl = document.getElementById('toast');
  let pollTimer = null;
  let todos = [];
  let filter = 'all'; // 'all' | 'pending' | 'done'

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

  // Local browser date as YYYY-MM-DD - matches the server's idea of
  // "today" (see lib/todos-store.js's localDateStr, same convention as
  // lib/study-store.js).
  function localTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fmtDueLabel(dueDate) {
    const today = localTodayStr();
    if (dueDate === today) return 'Today';
    if (dueDate < today) return `Overdue (${dueDate})`;
    const parts = dueDate.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function load() {
    try {
      const data = await api('/api/todos');
      todos = data.todos || [];
    } catch (e) {
      showToast(e.message);
    }
    render();
  }

  async function addTodo() {
    const textEl = document.getElementById('todo-new-text');
    const dateEl = document.getElementById('todo-new-date');
    const text = textEl.value.trim();
    if (!text) { showToast('Type something first.'); return; }
    try {
      await api('/api/todos', { method: 'POST', body: { text, dueDate: dateEl.value || null } });
      textEl.value = '';
      await load();
    } catch (e) { showToast(e.message); }
  }

  async function setDone(id, done) {
    try {
      await api(`/api/todos/${id}`, { method: 'PATCH', body: { done } });
      await load();
    } catch (e) { showToast(e.message); }
  }

  async function setDue(id, dueDate) {
    try {
      await api(`/api/todos/${id}`, { method: 'PATCH', body: { dueDate: dueDate || null } });
      await load();
    } catch (e) { showToast(e.message); }
  }

  async function delTodo(id) {
    try {
      await api(`/api/todos/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) { showToast(e.message); }
  }

  function todoRowHtml(t) {
    const dueBadge = t.dueDate
      ? `<input type="date" class="todo-due" data-id="${t.id}" value="${escapeHtml(t.dueDate)}" title="Re-schedule this to-do" />`
      : `<input type="date" class="todo-due" data-id="${t.id}" value="" title="Schedule this to-do on a day" />`;
    const overdue = !t.done && t.dueDate && t.dueDate < localTodayStr();
    const dueToday = !t.done && t.dueDate === localTodayStr();
    const cls = `todo-row${t.done ? ' done' : ''}${overdue ? ' overdue' : ''}${dueToday ? ' due-today' : ''}`;
    return `
      <div class="todo-row ${cls}" data-id="${t.id}">
        <button class="todo-check" data-id="${t.id}" data-done="${t.done ? '1' : '0'}" title="${t.done ? 'Untick - not done after all' : 'Tick off - shows on the calendar as done today'}">
          ${t.done ? '☑' : '☐'}
        </button>
        <span class="todo-text">${escapeHtml(t.text)}</span>
        ${dueBadge}
        <button class="todo-del" data-id="${t.id}" title="Delete">✕</button>
      </div>
    `;
  }

  function render() {
    const view = document.getElementById('view');
    if (!view) return;
    const pending = todos.filter((t) => !t.done);
    const done = todos.filter((t) => t.done);
    const filteredPending = filter === 'all' || filter === 'pending' ? pending : [];
    const filteredDone = filter === 'all' || filter === 'done' ? done : [];

    view.innerHTML = `
      <h1 class="page-title">To-Do</h1>
      <div class="todo-add-row">
        <input type="text" id="todo-new-text" maxlength="500" placeholder="Add a to-do… (e.g. Do new Sinhala lesson from that book)" />
        <input type="date" id="todo-new-date" value="${localTodayStr()}" title="Optional: schedule this to-do on a day" />
        <button class="btn" id="todo-add-btn">Add</button>
      </div>
      <div class="todo-filter-row">
        <button class="todo-filter-btn ${filter === 'all' ? 'on' : ''}" data-filter="all">All (${todos.length})</button>
        <button class="todo-filter-btn ${filter === 'pending' ? 'on' : ''}" data-filter="pending">To do (${pending.length})</button>
        <button class="todo-filter-btn ${filter === 'done' ? 'on' : ''}" data-filter="done">Done (${done.length})</button>
      </div>
      <div class="todo-list">
        ${filteredPending.length ? `
          <div class="todo-section-title">To do</div>
          ${filteredPending.map(todoRowHtml).join('')}
        ` : (filter === 'pending' ? '<div class="empty-state">Nothing left to do 🎉</div>' : '')}
        ${filteredDone.length ? `
          <div class="todo-section-title" style="margin-top:16px;">Done <span class="hint">(ticked-off dates show on the Calendar day they were done)</span></div>
          ${filteredDone.map(todoRowHtml).join('')}
        ` : (filter === 'done' ? '<div class="empty-state">Nothing ticked off yet.</div>' : '')}
        ${!todos.length ? '<div class="empty-state">No to-dos yet. Add one above - tick it off when done and it shows up on the Calendar.</div>' : ''}
      </div>
    `;

    document.getElementById('todo-add-btn').addEventListener('click', addTodo);
    document.getElementById('todo-new-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodo(); });
    view.querySelectorAll('.todo-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => { filter = btn.dataset.filter; render(); });
    });
    view.querySelectorAll('.todo-check').forEach((btn) => {
      btn.addEventListener('click', () => setDone(btn.dataset.id, btn.dataset.done !== '1'));
    });
    view.querySelectorAll('.todo-del').forEach((btn) => {
      btn.addEventListener('click', () => delTodo(btn.dataset.id));
    });
    view.querySelectorAll('.todo-due').forEach((input) => {
      input.addEventListener('change', () => setDue(input.dataset.id, input.value));
    });
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function renderSub() {
    stopPolling();
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = `<span>To-Do</span>`;
    document.getElementById('view').innerHTML = '<div class="empty-state">Loading…</div>';
    pollTimer = setInterval(load, 30000);
    await load();
  }

  window.TodoList = { render: renderSub };
  window.DexSubsystems = window.DexSubsystems || {};
  window.DexSubsystems['todos'] = { render: renderSub, cleanup: stopPolling };
})();
