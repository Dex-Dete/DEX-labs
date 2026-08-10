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
  // anything about this module's internals. v1.2.0: now also requires a
  // disk backup folder to be configured (see backupHtml() below) -
  // mandatory, same "forced first-run setup" mechanism as the original
  // AirDrop settings check just below it, extended rather than
  // duplicated.
  async function isSetupComplete() {
    try {
      const [s, backupStatus] = await Promise.all([
        api('/api/settings'),
        api('/api/backup/status'),
      ]);
      return !!s.setupComplete && !!backupStatus.disk.configured;
    } catch (e) {
      // If Settings/Backup themselves are unreachable, don't lock the
      // user out of the rest of the site over it - fail open.
      return true;
    }
  }

  // ---------------- v1.3.0: Appearance (theme) ----------------
  function appearanceHtml(theme) {
    return `
      <div class="panel" style="margin-top:16px;">
        <h2 style="margin-bottom:6px;">Appearance</h2>
        <div class="hint" style="margin-bottom:10px;">Dark/light mode is toggled from the 🌙/☀ button in the header on every page. Manually toggling holds your choice for 24 hours before auto-switching resumes. This just controls what "night" and "day" mean for auto mode - fixed clock hours, not sunrise/sunset (no reliable location to base that on).</div>
        <div class="form-row">
          <label style="display:flex; flex-direction:column; gap:6px;">
            <span>Dark mode starts at</span>
            <input type="number" id="set-theme-start" min="0" max="23" value="${theme.startHour}" style="width:90px;" /> <span class="hint">(24h, e.g. 19 = 7pm)</span>
          </label>
          <label style="display:flex; flex-direction:column; gap:6px;">
            <span>Dark mode ends at</span>
            <input type="number" id="set-theme-end" min="0" max="23" value="${theme.endHour}" style="width:90px;" /> <span class="hint">(24h, e.g. 7 = 7am)</span>
          </label>
        </div>
        <button class="btn" id="set-theme-save-btn" style="margin-top:10px;">Save appearance settings</button>
        <span id="set-theme-status" class="hint" style="margin-left:10px;"></span>
      </div>
    `;
  }

  // ---------------- v1.3.5: Navigation (moved out of the topbar) --------
  // The switch itself just flips window.DexNavMode (see app.js) - this
  // panel doesn't own the state, it's a remote control for it. Reads its
  // initial position straight from window.DexNavMode.get() so it always
  // matches whatever's actually applied right now, including if it was
  // set from a different tab/device (it's per-browser localStorage, so
  // in practice that won't happen, but reading live instead of caching
  // costs nothing here).
  function navigationHtml() {
    const mode = window.DexNavMode ? window.DexNavMode.get() : 'icon';
    return `
      <div class="panel" style="margin-top:16px;">
        <h2 style="margin-bottom:6px;">Navigation</h2>
        <div class="hint" style="margin-bottom:10px;">How the subsystem buttons in the header/menu are labeled - icons only, or full names. Applies everywhere (desktop header and mobile menu) and takes effect immediately.</div>
        <label class="set-nav-mode-row" style="display:flex; align-items:center; gap:10px; padding:6px 0; cursor:pointer;">
          <span class="toggle-switch">
            <input type="checkbox" id="set-nav-mode-checkbox" ${mode === 'name' ? 'checked' : ''} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </span>
          <span id="set-nav-mode-caption">${mode === 'name' ? 'Full names' : 'Icons only'}</span>
        </label>
      </div>
    `;
  }

  // ---------------- v1.3.0: Standby Mode ----------------
  function sbmHtml(sbm) {
    return `
      <div class="panel" style="margin-top:16px;">
        <h2 style="margin-bottom:6px;">Standby Mode</h2>
        <div class="hint" style="margin-bottom:10px;">Settings for the Standby Mode tab.</div>

        <label style="display:flex; align-items:center; gap:8px; padding:6px 0;">
          <input type="checkbox" id="set-sbm-stats" ${sbm.sbmStatsEnabled ? 'checked' : ''} />
          <span>Show host RAM/CPU stats in Standby Mode</span>
        </label>

        <label style="display:flex; align-items:center; gap:8px; padding:6px 0;">
          <input type="checkbox" id="set-sbm-todos" ${sbm.sbmTodosEnabled ? 'checked' : ''} />
          <span>Show today's to-do list in Standby Mode</span>
        </label>

        <div class="form-row" style="margin-top:8px;">
          <label style="display:flex; flex-direction:column; gap:6px;">
            <span>Standby Mode's clock format</span>
            <select id="set-sbm-clock-format">
              <option value="24" ${sbm.sbmClockFormat === '24' ? 'selected' : ''}>24-hour</option>
              <option value="12" ${sbm.sbmClockFormat === '12' ? 'selected' : ''}>12-hour (AM/PM)</option>
            </select>
          </label>
        </div>
        <div class="hint" style="margin:4px 0 10px;">Only affects Standby Mode's own big clock, not the rest of the site.</div>

        <label style="display:flex; align-items:center; gap:8px; padding:6px 0;">
          <input type="checkbox" id="set-sbm-ultra" ${sbm.sbmUltraGraphics ? 'checked' : ''} />
          <span>Ultra animations / 3D effects (Standby Mode only, independent of dark/light mode)</span>
        </label>

        <label style="display:flex; align-items:center; gap:8px; padding:6px 0;">
          <input type="checkbox" id="set-sbm-creature" ${sbm.sbmCreatureEnabled ? 'checked' : ''} />
          <span>Follow-mouse creature (needs dark mode + ultra animations both on; desktop only)</span>
        </label>
        <div class="form-row" style="margin-top:4px;">
          <label style="display:flex; flex-direction:column; gap:6px; flex:1; max-width:280px;">
            <span>Creature size</span>
            <input type="range" id="set-sbm-creature-size" min="1" max="10" step="1" value="${sbm.sbmCreatureSize}" />
          </label>
        </div>

        <button class="btn" id="set-sbm-save-btn" style="margin-top:10px;">Save Standby Mode settings</button>
        <span id="set-sbm-status" class="hint" style="margin-left:10px;"></span>
      </div>
    `;
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

  function formHtml(current, forced, backupForced) {
    return `
      ${forced ? `
        <div class="setup-required-banner">
          <strong>One-time setup required.</strong>
          ${!current.setupComplete && backupForced
            ? 'Before you can use DEX Labs, choose how AirDrop should behave on this PC, and pick a backup folder below.'
            : !current.setupComplete
              ? 'Before you can use DEX Labs, choose how AirDrop should behave on this PC.'
              : 'Before you can use DEX Labs, pick a backup folder below (see "Backup" section).'}
          You can change these anytime later from here, or from the tray icon's Settings menu.
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

  // v1.2.0: backup settings - disk (mandatory) + Google Drive (optional).
  // See lib/backup-store.js's header comment for the full design
  // reasoning (why drive.file scope, why "Desktop app" OAuth client
  // type, why backup.json itself is excluded, etc).
  function backupHtml(status) {
    const disk = status.disk;
    const drive = status.drive;
    const fmtWhen = (ms) => (ms ? new Date(ms).toLocaleString() : 'never yet');

    const driveSection = !drive.credentialsSet ? `
      <div class="hint" style="margin-bottom:10px;">
        Optional. Back up the same data to Google Drive too, every 30 minutes, in a folder called
        "DEX Labs Backups" that only this app can see/touch. Needs a free Google OAuth client you create
        yourself (takes a couple of minutes) - DEX Labs can't create one on your behalf since every
        install of it runs on your own PC:
        <ol style="margin:8px 0 0; padding-left:20px;">
          <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console → Credentials</a> (create a project first if you don't have one)</li>
          <li>"Create Credentials" → "OAuth client ID" → Application type: <strong>Desktop app</strong></li>
          <li>Copy the Client ID and Client Secret it gives you into the boxes below</li>
        </ol>
      </div>
      <div class="form-row" style="margin-bottom:10px;">
        <input type="text" id="set-drive-client-id" placeholder="Client ID" style="flex:2; min-width:220px;" />
        <input type="text" id="set-drive-client-secret" placeholder="Client Secret" style="flex:1; min-width:160px;" />
      </div>
      <button class="btn secondary" id="set-drive-save-creds-btn">Save Google credentials</button>
      <span id="set-drive-creds-status" class="hint" style="margin-left:10px;"></span>
    ` : !drive.linked ? `
      <div class="hint" style="margin-bottom:10px;">Google credentials saved${drive.clientId ? ` (Client ID ending …${escapeHtml(drive.clientId.slice(-12))})` : ''}. Click connect and sign in - a Google tab will open.</div>
      <button class="btn secondary" id="set-drive-connect-btn">Connect Google Drive</button>
      <span id="set-drive-connect-status" class="hint" style="margin-left:10px;"></span>
    ` : `
      <div class="hint" style="margin-bottom:10px;">
        ✅ Linked. Last backed up: ${fmtWhen(drive.lastOkAt)}${drive.lastError ? ` — <span style="color:var(--pen);">${escapeHtml(drive.lastError)}</span>` : ''}
      </div>
      <button class="btn secondary" id="set-drive-run-btn">Back up to Drive now</button>
      <button class="btn secondary" id="set-drive-disconnect-btn" style="margin-left:8px;">Disconnect</button>
      <span id="set-drive-run-status" class="hint" style="margin-left:10px;"></span>
    `;

    return `
      <div class="panel" style="margin-top:16px;">
        <h2 style="margin-bottom:6px;">Backup</h2>
        <div class="hint" style="margin-bottom:14px;">Keeps your data safe somewhere other than the DEX Labs folder, so a reinstall (or a mistake) can't lose it.</div>

        <h3 style="margin:0 0 6px; font-size:0.95rem;">Backup folder on this PC <span class="hint">(mandatory, backs up every 3 minutes)</span></h3>
        <div class="form-row" style="margin-bottom:8px;">
          <input type="text" id="set-disk-path" value="${escapeHtml(disk.path || '')}" placeholder="e.g. D:\\Backups\\DexLabs" style="flex:1; min-width:220px;" />
          <button class="btn secondary" id="set-disk-browse-btn">Browse…</button>
          <button class="btn" id="set-disk-save-btn">Save</button>
        </div>
        <div class="hint" style="margin-bottom:8px;">
          ${disk.configured
            ? `Currently: <code>${escapeHtml(disk.path)}</code> — last backed up: ${fmtWhen(disk.lastOkAt)}${disk.lastError ? ` — <span style="color:var(--pen);">${escapeHtml(disk.lastError)}</span>` : ''}`
            : 'Not set up yet - pick any folder outside the DEX Labs app folder.'}
        </div>
        ${disk.configured ? `<button class="btn secondary" id="set-disk-run-btn">Back up now</button> <span id="set-disk-run-status" class="hint" style="margin-left:10px;"></span>` : ''}

        <h3 style="margin:20px 0 6px; font-size:0.95rem;">Google Drive <span class="hint">(optional, backs up every 30 minutes)</span></h3>
        ${driveSection}
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
    let backupStatus;
    let theme;
    let sbmSettings;
    try {
      [current, subsysData, backupStatus, theme, sbmSettings] = await Promise.all([
        api('/api/settings'),
        api('/api/settings/subsystems'),
        api('/api/backup/status'),
        api('/api/settings/theme'),
        api('/api/settings/sbm'),
      ]);
    } catch (e) {
      document.getElementById('settings-panel').innerHTML = `<div class="empty-state">Could not load settings: ${escapeHtml(e.message)}</div>`;
      return;
    }

    const backupForced = !backupStatus.disk.configured;
    const forced = !current.setupComplete || backupForced;
    document.getElementById('settings-panel').innerHTML = formHtml(current, forced, backupForced) + backupHtml(backupStatus) + subsystemsHtml(subsysData) + appearanceHtml(theme) + navigationHtml() + sbmHtml(sbmSettings);

    const navModeCheckbox = document.getElementById('set-nav-mode-checkbox');
    const navModeCaption = document.getElementById('set-nav-mode-caption');
    if (navModeCheckbox) {
      navModeCheckbox.addEventListener('change', () => {
        const mode = navModeCheckbox.checked ? 'name' : 'icon';
        if (window.DexNavMode) window.DexNavMode.set(mode);
        if (navModeCaption) navModeCaption.textContent = mode === 'name' ? 'Full names' : 'Icons only';
      });
    }

    document.getElementById('set-theme-save-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('set-theme-status');
      const startHour = Number(document.getElementById('set-theme-start').value);
      const endHour = Number(document.getElementById('set-theme-end').value);
      try {
        statusEl.textContent = 'Saving…';
        await api('/api/settings/theme', { method: 'PUT', body: { darkStartHour: startHour, darkEndHour: endHour } });
        showToast('Appearance settings saved');
        statusEl.textContent = '';
      } catch (e) {
        statusEl.textContent = e.message;
      }
    });

    document.getElementById('set-sbm-save-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('set-sbm-status');
      try {
        statusEl.textContent = 'Saving…';
        await api('/api/settings/sbm', {
          method: 'PUT',
          body: {
            sbmStatsEnabled: document.getElementById('set-sbm-stats').checked,
            sbmTodosEnabled: document.getElementById('set-sbm-todos').checked,
            sbmClockFormat: document.getElementById('set-sbm-clock-format').value,
            sbmUltraGraphics: document.getElementById('set-sbm-ultra').checked,
            sbmCreatureEnabled: document.getElementById('set-sbm-creature').checked,
            sbmCreatureSize: Number(document.getElementById('set-sbm-creature-size').value),
          },
        });
        showToast('Standby Mode settings saved');
        statusEl.textContent = '';
      } catch (e) {
        statusEl.textContent = e.message;
      }
    });

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

    // Used after any single step of the forced first-run setup is saved
    // (AirDrop settings, or the backup folder) - only leaves the
    // Settings page once EVERY required step is actually done, since
    // v1.2.0 there are two independent ones. Re-checks fresh from the
    // server rather than trusting the `forced`/`backupForced` values
    // captured when this render() call started, since either one could
    // have just changed.
    async function afterSetupStepSaved() {
      if (await isSetupComplete()) {
        window.location.hash = '#/';
      } else {
        render();
      }
    }

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
        if (forced) { await afterSetupStepSaved(); } else { render(); }
      } catch (e) {
        statusEl.textContent = e.message;
      }
    });

    // ---------------- Backup: disk ----------------

    document.getElementById('set-disk-save-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('set-disk-run-status') || { textContent: '' };
      const p = document.getElementById('set-disk-path').value.trim();
      try {
        await api('/api/backup/disk-path', { method: 'PUT', body: { path: p } });
        showToast('Backup folder saved');
        if (backupForced) { await afterSetupStepSaved(); } else { render(); }
      } catch (e) {
        statusEl.textContent = e.message;
        showToast(e.message);
      }
    });

    document.getElementById('set-disk-browse-btn').addEventListener('click', async () => {
      try {
        const result = await api('/api/backup/disk/browse', { method: 'POST' });
        document.getElementById('set-disk-path').value = result.path;
      } catch (e) {
        showToast(e.message);
      }
    });

    const diskRunBtn = document.getElementById('set-disk-run-btn');
    if (diskRunBtn) {
      diskRunBtn.addEventListener('click', async () => {
        const statusEl = document.getElementById('set-disk-run-status');
        statusEl.textContent = 'Backing up…';
        try {
          const result = await api('/api/backup/disk/run-now', { method: 'POST' });
          statusEl.textContent = result.ok ? `Done - ${result.filesCopied} file(s).` : (result.error || 'Failed.');
          if (result.ok) render();
        } catch (e) {
          statusEl.textContent = e.message;
        }
      });
    }

    // ---------------- Backup: Google Drive ----------------

    const driveSaveCredsBtn = document.getElementById('set-drive-save-creds-btn');
    if (driveSaveCredsBtn) {
      driveSaveCredsBtn.addEventListener('click', async () => {
        const statusEl = document.getElementById('set-drive-creds-status');
        const clientId = document.getElementById('set-drive-client-id').value.trim();
        const clientSecret = document.getElementById('set-drive-client-secret').value.trim();
        try {
          statusEl.textContent = 'Saving…';
          await api('/api/backup/drive/credentials', { method: 'PUT', body: { clientId, clientSecret } });
          render();
        } catch (e) {
          statusEl.textContent = e.message;
        }
      });
    }

    const driveConnectBtn = document.getElementById('set-drive-connect-btn');
    if (driveConnectBtn) {
      driveConnectBtn.addEventListener('click', async () => {
        const statusEl = document.getElementById('set-drive-connect-status');
        try {
          const { url } = await api('/api/backup/drive/auth-url');
          window.open(url, '_blank', 'noopener');
          statusEl.textContent = 'Waiting for Google… (finish signing in in the new tab)';
          // The OAuth consent flow finishes in that new tab, not this
          // one - poll status for a couple of minutes so this page
          // updates itself the moment it's linked, without the person
          // needing to manually refresh.
          const pollUntil = Date.now() + 2 * 60 * 1000;
          const poll = setInterval(async () => {
            if (Date.now() > pollUntil) { clearInterval(poll); statusEl.textContent = ''; return; }
            try {
              const s = await api('/api/backup/status');
              if (s.drive.linked) {
                clearInterval(poll);
                showToast('Google Drive connected');
                render();
              }
            } catch (e) { /* keep polling */ }
          }, 2000);
        } catch (e) {
          statusEl.textContent = e.message;
        }
      });
    }

    const driveRunBtn = document.getElementById('set-drive-run-btn');
    if (driveRunBtn) {
      driveRunBtn.addEventListener('click', async () => {
        const statusEl = document.getElementById('set-drive-run-status');
        statusEl.textContent = 'Backing up…';
        try {
          const result = await api('/api/backup/drive/run-now', { method: 'POST' });
          statusEl.textContent = result.ok ? `Done - ${result.filesUploaded} file(s).` : (result.error || 'Failed.');
          if (result.ok) render();
        } catch (e) {
          statusEl.textContent = e.message;
        }
      });
    }

    const driveDisconnectBtn = document.getElementById('set-drive-disconnect-btn');
    if (driveDisconnectBtn) {
      driveDisconnectBtn.addEventListener('click', async () => {
        if (!confirm('Disconnect Google Drive backup? Your existing backup files on Drive are left as-is - this just stops DEX Labs from writing to them.')) return;
        try {
          await api('/api/backup/drive/disconnect', { method: 'POST' });
          showToast('Google Drive disconnected');
          render();
        } catch (e) {
          showToast(e.message);
        }
      });
    }
  }

  window.Settings = { render, isSetupComplete };
})();
