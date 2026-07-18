// Settings: a self-contained module, same isolation pattern as
// airdrop.js/schedule.js/timers.js. Holds the new v1.0.5 "installation
// settings" (AirDrop max usage + save location) and enforces the forced
// first-run setup flow - see app.js's route() for the redirect logic
// that sends the user here until setupComplete is true.
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

  // Exposed so app.js's router can check "is setup done?" before
  // deciding whether to force a redirect here, without needing to know
  // anything about this module's internals.
  async function isSetupComplete() {
    try {
      const s = await api('/api/settings');
      return !!s.setupComplete;
    } catch (e) {
      // If Settings itself is unreachable, don't lock the user out of
      // the rest of the site over it - fail open.
      return true;
    }
  }

  function subsystemsHtml(data) {
    const hidden = new Set(data.hiddenSubsystems || []);
    const rows = (data.subsystems || []).map((s) => `
      <label style="display:flex; align-items:center; gap:8px; padding:6px 0;">
        <input type="checkbox" class="set-subsys-check" data-id="${escapeHtml(s.id)}" ${hidden.has(s.id) ? '' : 'checked'} />
        <span>${escapeHtml(s.label)}</span>
      </label>
    `).join('');
    const landingOptions = (data.subsystems || [])
      .filter((s) => !hidden.has(s.id))
      .map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === data.defaultLandingSubsystem ? 'selected' : ''}>${escapeHtml(s.label)}</option>`)
      .join('');
    return `
      <div class="panel" style="margin-top:16px;">
        <h2 style="margin-bottom:6px;">Subsystems</h2>
        <div class="hint" style="margin-bottom:10px;">Untick anything you'd rather not see in the menu right now - you can turn it back on anytime. This is also available from the tray icon's Settings menu.</div>
        <div id="set-subsys-list">${rows}</div>

        <div class="form-row" style="margin-top:14px;">
          <label style="display:flex; flex-direction:column; gap:6px; flex:1; min-width:220px;">
            <span>Show this first when the site loads</span>
            <select id="set-landing-select">${landingOptions}</select>
          </label>
        </div>
        <div class="hint" style="margin:6px 0 14px;">Only subsystems that are ticked above can be picked here - if you hide the one currently selected, this list updates and something else takes its place.</div>

        <button class="btn" id="set-subsys-save-btn">Save subsystem visibility</button>
        <span id="set-subsys-status" class="hint" style="margin-left:10px;"></span>
      </div>
    `;
  }

  function formHtml(current, forced) {
    return `
      ${forced ? `
        <div class="setup-required-banner">
          <strong>One-time setup required.</strong> Before you can use DEX Labs, choose how AirDrop should behave on this PC. You can change these anytime later from here, or from the tray icon's Settings menu.
        </div>
      ` : ''}
      <div class="panel">
        <h2 style="margin-bottom:10px;">AirDrop settings</h2>
        <div class="form-row" style="margin-bottom:14px;">
          <label style="display:flex; flex-direction:column; gap:6px; flex:1; min-width:220px;">
            <span>Maximum AirDrop usage (GB)</span>
            <input type="text" inputmode="numeric" id="set-airdrop-max" value="${escapeHtml(String(current.airdropMaxUsageGB))}" placeholder="30" />
          </label>
        </div>
        <div class="hint" style="margin:-6px 0 14px;">Combined total across everything currently sitting in AirDrop at once (not per-file) - the same rule as before, just now adjustable instead of a fixed 30GB.</div>

        <div class="form-row" style="margin-bottom:14px;">
          <label style="display:flex; flex-direction:column; gap:6px; flex:1; min-width:220px;">
            <span>AirDrop save location (folder path on this PC)</span>
            <input type="text" id="set-airdrop-location" value="${escapeHtml(current.airdropSaveLocation || '')}" placeholder="Leave blank to use the default folder" />
          </label>
        </div>
        <div class="hint" style="margin:-6px 0 18px;">Leave blank to use DEX Labs' own <code>uploads-airdrop</code> folder. To pick a folder with a browse dialog instead of typing a path, use the tray icon's Settings menu on the PC itself.</div>

        <button class="btn" id="set-save-btn">Save settings</button>
        <span id="set-save-status" class="hint" style="margin-left:10px;"></span>
      </div>
    `;
  }

  async function render() {
    const crumbs = document.getElementById('crumbs');
    crumbs.innerHTML = '<span>Settings</span>';
    const view = document.getElementById('view');
    view.innerHTML = `
      <h1 class="page-title">Settings</h1>
      <div id="settings-panel"><div class="empty-state">Loading…</div></div>
    `;

    let current;
    let subsysData;
    try {
      [current, subsysData] = await Promise.all([
        api('/api/settings'),
        api('/api/settings/subsystems'),
      ]);
    } catch (e) {
      document.getElementById('settings-panel').innerHTML = `<div class="empty-state">Could not load settings: ${escapeHtml(e.message)}</div>`;
      return;
    }

    const forced = !current.setupComplete;
    document.getElementById('settings-panel').innerHTML = formHtml(current, forced) + subsystemsHtml(subsysData);

    // Keep the "show this first" dropdown's options in sync with which
    // checkboxes are currently ticked, live, before the user even hits
    // Save - so they never end up picking something they're about to hide.
    function refreshLandingOptions() {
      const select = document.getElementById('set-landing-select');
      const prevValue = select.value;
      const checkedIds = Array.from(document.querySelectorAll('.set-subsys-check'))
        .filter((cb) => cb.checked)
        .map((cb) => cb.dataset.id);
      select.innerHTML = (subsysData.subsystems || [])
        .filter((s) => checkedIds.includes(s.id))
        .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`)
        .join('');
      if (checkedIds.includes(prevValue)) select.value = prevValue;
    }
    document.querySelectorAll('.set-subsys-check').forEach((cb) => {
      cb.addEventListener('change', refreshLandingOptions);
    });

    document.getElementById('set-subsys-save-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('set-subsys-status');
      const hiddenSubsystems = Array.from(document.querySelectorAll('.set-subsys-check'))
        .filter((cb) => !cb.checked)
        .map((cb) => cb.dataset.id);
      const defaultLandingSubsystem = document.getElementById('set-landing-select').value;

      if (hiddenSubsystems.length >= (subsysData.subsystems || []).length) {
        statusEl.textContent = 'At least one subsystem has to stay visible.';
        return;
      }

      try {
        statusEl.textContent = 'Saving…';
        await api('/api/settings/subsystems', {
          method: 'PUT',
          body: { hiddenSubsystems, defaultLandingSubsystem },
        });
        showToast('Subsystem visibility saved');
        statusEl.textContent = '';
        // The nav in app.js rebuilds itself on every route() call, so
        // simply re-rendering here is enough for everything to reflect
        // the new visibility/landing choice immediately.
        render();
      } catch (e) {
        statusEl.textContent = e.message;
      }
    });

    document.getElementById('set-save-btn').addEventListener('click', async () => {
      const maxInput = document.getElementById('set-airdrop-max').value.trim();
      const saveLocation = document.getElementById('set-airdrop-location').value.trim();
      const maxGb = Number(maxInput);
      const statusEl = document.getElementById('set-save-status');

      if (!maxInput || !Number.isFinite(maxGb) || maxGb <= 0) {
        statusEl.textContent = 'Enter a valid number of GB.';
        return;
      }

      try {
        statusEl.textContent = 'Saving…';
        await api('/api/settings', {
          method: 'PUT',
          body: { airdropMaxUsageGB: maxGb, airdropSaveLocation: saveLocation },
        });
        showToast('Settings saved');
        // If this was the forced first-run setup, saving satisfies it -
        // send the user on to the site now that they're unblocked.
        // Otherwise just re-render this page fresh (clears the "forced"
        // banner if it was somehow still showing, refreshes the fields
        // from what actually got saved).
        if (forced) {
          window.location.hash = '#/';
        } else {
          render();
        }
      } catch (e) {
        statusEl.textContent = e.message;
      }
    });
  }

  window.Settings = { render, isSetupComplete };
})();
