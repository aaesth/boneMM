/* renderer.js — all events wired in JS, zero inline onclick */
const api = window.bonemm;
const PAGE_SIZE = 20;

const S = {
  apiKey: '', modFolder: '', exePath: '',
  mods: [], installed: [], profiles: [], activeProfileId: null,
  updates: [], updating: {}, installing: {},
  sort: 'popular', search: '', tag: '',
  page: 1, total: 0,
  selectedMod: null, currentView: 'installed',
  _shareTarget: null,
};

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  const cfg = await api.getConfig();
  S.apiKey = cfg.apiKey || '';
  S.modFolder = cfg.modFolder || '';
  S.exePath = cfg.exePath || '';
  S.installed = cfg.installed || [];
  S.profiles = cfg.profiles || [];
  S.activeProfileId = cfg.activeProfileId || null;

  if (S.apiKey) document.getElementById('api-key-field').value = S.apiKey;
  if (S.modFolder) document.getElementById('folder-field').value = S.modFolder;
  if (S.exePath) document.getElementById('exe-field').value = S.exePath;

  wireEvents();
  updateInstalledBadge();
  showView('installed');

  api.onInstallProgress(({ modId, status, progress }) => {
    S.installing[modId] = { status, progress };
    if (S.updates.find(u => u.id === modId)) {
      S.updating[modId] = status;
      if (S.currentView === 'updates') renderUpdatesView();
    }
    refreshRow(modId);
    if (S.selectedMod?.id === modId) renderDetail(S.selectedMod);
  });
}

function wireEvents() {
  // Nav items
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  // Online toolbar
  document.getElementById('btn-sort').addEventListener('click', e => { e.stopPropagation(); toggleDropdown('sort-dropdown'); });
  document.getElementById('btn-filter').addEventListener('click', e => { e.stopPropagation(); toggleDropdown('filter-dropdown'); buildFilterTags(); });
  document.getElementById('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') { S.search = e.target.value.trim(); S.page = 1; loadMods(); } });
  document.getElementById('btn-clear-filter').addEventListener('click', () => clearFilter());

  // Sort buttons
  document.querySelectorAll('#sort-dropdown button[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => { setSort(btn.dataset.sort); });
  });

  // Installed toolbar
  document.getElementById('btn-open-folder').addEventListener('click', () => api.openInExplorer(S.modFolder));

  // Updates toolbar
  document.getElementById('btn-check-updates').addEventListener('click', checkAllUpdates);
  document.getElementById('btn-update-all').addEventListener('click', updateAllMods);

  // Profiles toolbar
  document.getElementById('btn-new-profile').addEventListener('click', openCreateProfileModal);
  document.getElementById('btn-import-profile').addEventListener('click', openImportModal);

  // Settings
  document.getElementById('btn-save-key').addEventListener('click', saveApiKey);
  document.getElementById('btn-test-key').addEventListener('click', testConnection);
  document.getElementById('btn-browse-folder').addEventListener('click', openFolderDialog);
  document.getElementById('btn-open-folder2').addEventListener('click', () => api.openInExplorer(S.modFolder));
  document.getElementById('btn-browse-exe').addEventListener('click', openExeDialog);

  // Modal closes via data-close attribute
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
  });

  // Profile modal actions
  document.getElementById('btn-create-profile').addEventListener('click', createProfile);
  document.getElementById('btn-copy-code').addEventListener('click', copyShareCode);
  document.getElementById('btn-export-file').addEventListener('click', exportProfileFile);
  document.getElementById('btn-do-import').addEventListener('click', importProfile);
  document.getElementById('import-code-text').addEventListener('input', previewImportCode);

  // Link spans that navigate to a view
  document.querySelectorAll('.link[data-view]').forEach(el => {
    el.addEventListener('click', () => showView(el.dataset.view));
  });

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    document.getElementById('sort-dropdown').style.display = 'none';
    document.getElementById('filter-dropdown').style.display = 'none';
  });
}

function toggleDropdown(id) {
  const dd = document.getElementById(id);
  const other = id === 'sort-dropdown' ? 'filter-dropdown' : 'sort-dropdown';
  document.getElementById(other).style.display = 'none';
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

// ── Views ─────────────────────────────────────────────────────────────────────
function showView(name) {
  S.currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  const nav = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (view) view.classList.add('active');
  if (nav) nav.classList.add('active');
  if (name === 'online' && !S.mods.length) loadMods();
  if (name === 'installed') renderInstalled();
  if (name === 'profiles') renderProfiles();
  if (name === 'updates') renderUpdatesView();
}

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(msg, type = '') {
  document.getElementById('status-dot').className = 'status-dot' + (type ? ' ' + type : '');
  document.getElementById('status-text').textContent = msg;
}

// ── Online / mods ─────────────────────────────────────────────────────────────
async function loadMods() {
  if (!S.apiKey) {
    document.getElementById('api-warning').style.display = 'block';
    document.getElementById('mod-list').innerHTML = '';
    document.getElementById('pagination').innerHTML = '';
    return;
  }
  document.getElementById('api-warning').style.display = 'none';
  setStatus('Loading…', 'loading');

  const res = await api.fetchMods({ apiKey: S.apiKey, sort: S.sort, search: S.search, tag: S.tag, offset: (S.page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
  if (!res.ok) { setStatus('Error loading mods', 'error'); return; }

  S.mods = res.data.data || [];
  S.total = res.data.result_total || 0;
  document.getElementById('online-count').textContent = S.total ? fmtNum(S.total) : '';
  setStatus('Ready');
  renderModList();
  renderPagination();
}

function renderModList() {
  const list = document.getElementById('mod-list');
  if (!S.mods.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No mods found</div></div>`;
    return;
  }
  list.innerHTML = '';
  S.mods.forEach(mod => {
    const row = document.createElement('div');
    row.className = 'mod-row' + (S.selectedMod?.id === mod.id ? ' selected' : '');
    row.id = 'row-' + mod.id;
    row.innerHTML = buildRowHTML(mod);
    row.addEventListener('click', () => selectMod(mod));
    list.appendChild(row);
  });
}

function buildRowHTML(mod) {
  const inst = S.installed.find(i => i.id === mod.id);
  const instState = S.installing[mod.id];
  const thumb = mod.logo?.thumb_320x180 || mod.logo?.thumb_640x360 || '';
  const isWorking = instState && instState.status !== 'done' && instState.status !== 'error';
  const progress = isWorking ? `<div class="row-progress"><div class="row-progress-fill" style="width:${instState.progress}%"></div></div>` : '';
  const check = (inst || instState?.status === 'done') ? '<div class="row-check">✓</div>' : '<div class="row-check"></div>';
  return `
    <div class="row-thumb">${thumb ? `<img src="${thumb}" onerror="this.style.display='none'" />` : '🦴'}</div>
    <div class="row-info">
      <div class="row-name">${esc(mod.name)}</div>
      <div class="row-author">${esc(mod.submitted_by?.username || '?')}</div>
      ${progress}
    </div>
    ${check}`;
}

function refreshRow(modId) {
  const row = document.getElementById('row-' + modId);
  if (!row) return;
  const mod = S.mods.find(m => m.id === modId);
  if (mod) { row.innerHTML = buildRowHTML(mod); row.addEventListener('click', () => selectMod(mod)); }
}

function renderPagination() {
  const total = Math.ceil(S.total / PAGE_SIZE);
  const pg = document.getElementById('pagination');
  if (total <= 1) { pg.innerHTML = ''; return; }
  pg.innerHTML = '';
  getPageRange(S.page, total).forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (p === S.page ? ' active' : '') + (p === '…' ? ' dots' : '');
    btn.textContent = p;
    if (p !== '…') btn.addEventListener('click', () => { S.page = p; loadMods(); document.getElementById('mod-list-wrap').scrollTop = 0; });
    pg.appendChild(btn);
  });
}

function getPageRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const p = [1];
  if (cur > 3) p.push('…');
  for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) p.push(i);
  if (cur < total - 2) p.push('…');
  p.push(total);
  return p;
}

// ── Select mod & detail ───────────────────────────────────────────────────────
function selectMod(mod) {
  S.selectedMod = mod;
  document.querySelectorAll('.mod-row').forEach(r => r.classList.remove('selected'));
  const row = document.getElementById('row-' + mod.id);
  if (row) row.classList.add('selected');
  renderDetail(mod);
}

function renderDetail(mod) {
  document.getElementById('detail-empty').style.display = 'none';
  document.getElementById('detail-content').style.display = 'flex';

  const inst = S.installed.find(i => i.id === mod.id);
  const instState = S.installing[mod.id];
  const thumb = mod.logo?.thumb_640x360 || mod.logo?.original || '';
  const dl = fmtNum(mod.stats?.downloads_total || 0);
  const updated = mod.date_updated ? new Date(mod.date_updated * 1000).toLocaleString() : '—';
  const size = mod.modfile?.filesize ? fmtBytes(mod.modfile.filesize) : '—';
  const tags = (mod.tags || []).map(t => `<span class="detail-tag">${esc(t.name)}</span>`).join('');

  let btnClass = 'idle', btnText = 'Download';
  if (inst) { btnClass = 'done'; btnText = 'Installed ✓'; }
  if (instState) {
    if (instState.status === 'done') { btnClass = 'done'; btnText = 'Installed ✓'; }
    else if (instState.status === 'error') { btnClass = 'error'; btnText = 'Failed — retry'; }
    else if (instState.status === 'extracting') { btnClass = 'working'; btnText = 'Extracting…'; }
    else if (instState.status === 'downloading') { btnClass = 'working'; btnText = `Downloading ${instState.progress}%`; }
  }

  const dc = document.getElementById('detail-content');
  dc.innerHTML = `
    ${thumb ? `<img class="detail-hero" src="${thumb}" />` : '<div class="detail-hero-placeholder">🦴</div>'}
    <div class="detail-body">
      <div class="detail-name">${esc(mod.name)}</div>
      <div class="detail-author">By ${esc(mod.submitted_by?.username || '?')}</div>
      <div class="detail-meta">
        <div class="detail-meta-row">${esc(mod.summary || '')}</div><br>
        <div class="detail-meta-row"><strong>Downloads:</strong> ${dl}</div>
        <div class="detail-meta-row"><strong>Updated:</strong> ${updated}</div>
        <div class="detail-meta-row"><strong>File size:</strong> ${size}</div>
        ${tags ? `<div class="detail-tags">${tags}</div>` : ''}
      </div>
      <div class="detail-actions">
        <button class="detail-install-btn ${btnClass}" id="detail-install-btn">${btnText}</button>
        <button class="detail-view-btn" id="detail-view-btn">View online</button>
        ${inst ? `<button class="detail-view-btn" id="detail-uninstall-btn" style="color:var(--red);border-color:var(--red)">Uninstall</button>` : ''}
      </div>
      <div class="detail-divider"></div>
      <div class="detail-readme">${esc(mod.description_plaintext || mod.summary || 'No description.')}</div>
    </div>`;

  document.getElementById('detail-install-btn').addEventListener('click', () => handleInstall(mod.id));
  document.getElementById('detail-view-btn').addEventListener('click', () => { const a = document.createElement('a'); a.href = `https://mod.io/g/bonelab/m/${mod.name_id || mod.id}`; a.target = '_blank'; a.click(); });
  const uBtn = document.getElementById('detail-uninstall-btn');
  if (uBtn) uBtn.addEventListener('click', () => handleUninstall(mod.id));
}

// ── Install ───────────────────────────────────────────────────────────────────
async function handleInstall(modId) {
  const mod = S.mods.find(m => m.id === modId) || S.selectedMod;
  if (!mod) return;
  if (!S.modFolder) { alert('Set your BONELAB Mods folder in Settings first.'); showView('settings'); return; }
  S.installing[modId] = { status: 'downloading', progress: 0 };
  refreshRow(modId);
  if (S.selectedMod?.id === modId) renderDetail(mod);
  setStatus(`Installing ${mod.name}…`, 'loading');
  const res = await api.installMod({ mod, apiKey: S.apiKey });
  if (res.ok) {
    S.installed = (await api.getConfig()).installed;
    delete S.installing[modId];
    refreshRow(modId);
    if (S.selectedMod?.id === modId) renderDetail(mod);
    updateInstalledBadge();
    setStatus(`Installed: ${mod.name} ✓`);
  } else {
    S.installing[modId] = { status: 'error', progress: 0 };
    refreshRow(modId);
    if (S.selectedMod?.id === modId) renderDetail(mod);
    setStatus('Install failed: ' + res.error, 'error');
    setTimeout(() => { delete S.installing[modId]; refreshRow(modId); if (S.selectedMod?.id === modId) renderDetail(mod); }, 4000);
  }
}

async function handleUninstall(modId) {
  const mod = S.installed.find(i => i.id === modId);
  if (!mod || !confirm(`Remove "${mod.name}"?`)) return;
  const res = await api.uninstallMod(modId);
  if (res.ok) {
    S.installed = S.installed.filter(i => i.id !== modId);
    updateInstalledBadge();
    refreshRow(modId);
    renderInstalled();
    if (S.selectedMod?.id === modId) renderDetail(S.mods.find(m => m.id === modId) || S.selectedMod);
    setStatus('Mod removed');
  } else setStatus('Remove failed: ' + res.error, 'error');
}

// ── Installed ─────────────────────────────────────────────────────────────────
function renderInstalled() {
  updateInstalledBadge();
  const list = document.getElementById('installed-list');

  // --- ADD THIS FILTER BLOCK ---
  // Get the currently active profile
  const activeProfile = S.profiles.find(p => p.id === S.activeProfileId);

  // Only show mods that belong to the active profile
  // If no profile is active, you can choose to show nothing or everything
  const displayMods = activeProfile
    ? S.installed.filter(instMod => activeProfile.mods.some(pMod => pMod.id === instMod.id))
    : S.installed;
  // -----------------------------

  if (!displayMods.length) {
    list.innerHTML = `<div class="empty-state">...No mods in this profile...</div>`;
    return;
  }

  list.innerHTML = '';
  [...displayMods].reverse().forEach(mod => {
    const isOn = mod.enabled !== false;
    const row = document.createElement('div');
    row.className = 'installed-row';
    row.innerHTML = `
      <div class="row-thumb">${mod.logo ? `<img src="${mod.logo}" onerror="this.style.display='none'" />` : '🦴'}</div>
      <div class="row-info" style="padding:0 14px">
        <div class="row-name">${esc(mod.name)}</div>
        <div class="row-author">${new Date(mod.date).toLocaleDateString()}${mod.filesize ? ' · ' + fmtBytes(mod.filesize) : ''}</div>
      </div>
      <div class="row-actions">
        <div class="toggle ${isOn ? 'on' : ''}" data-mod-id="${mod.id}" title="${isOn ? 'Enabled' : 'Disabled'}"></div>
        <button class="toolbar-btn" style="padding:4px 8px;font-size:11px" data-open-folder="${mod.id}">📂</button>
        <button class="remove-btn" data-remove-mod="${mod.id}">Remove</button>
      </div>`;
    row.querySelector('.toggle').addEventListener('click', () => toggleMod(mod.id));
    row.querySelector(`[data-open-folder]`).addEventListener('click', () => api.openModFolder(mod.id));
    row.querySelector(`[data-remove-mod]`).addEventListener('click', () => confirmUninstall(mod.id));
    list.appendChild(row);
  });
}

async function toggleMod(modId) {
  const mod = S.installed.find(i => i.id === modId); if (!mod) return;
  const res = await api.toggleMod({ modId, enabled: mod.enabled === false });
  if (res.ok) { S.installed = (await api.getConfig()).installed; renderInstalled(); }
  else setStatus('Toggle failed', 'error');
}

async function confirmUninstall(modId) {
  const mod = S.installed.find(i => i.id === modId);
  if (!mod || !confirm(`Remove "${mod.name}" and delete its files?`)) return;
  await handleUninstall(modId);
}

function updateInstalledBadge() {
  const n = S.installed.length;
  const b = document.getElementById('installed-badge');
  b.style.display = n ? 'inline' : 'none';
  b.textContent = n;
}

// ── Updates ───────────────────────────────────────────────────────────────────
function renderUpdatesView() {
  const body = document.getElementById('updates-body');
  document.getElementById('btn-update-all').style.display = S.updates.length ? 'inline-block' : 'none';

  if (!S.updates.length) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon" style="font-size:36px">✓</div><div class="empty-title">No updates found</div><div class="empty-sub">Click "Check for updates" to scan your ${S.installed.length} installed mod${S.installed.length !== 1 ? 's' : ''}</div></div>`;
    return;
  }

  body.innerHTML = `<div class="updates-summary"><span class="count">${S.updates.length}</span> update${S.updates.length !== 1 ? 's' : ''} available</div>`;

  S.updates.forEach(u => {
    const state = S.updating[u.id];
    let btnText = '↑ Update', btnClass = '';
    if (state === 'downloading' || state === 'extracting') { btnText = state === 'extracting' ? 'Installing…' : 'Downloading…'; btnClass = 'working'; }
    else if (state === 'done') { btnText = '✓ Updated'; btnClass = 'done'; }
    else if (state === 'error') { btnText = '✗ Retry'; btnClass = 'error'; }

    const row = document.createElement('div');
    row.className = 'update-row';
    row.id = 'update-row-' + u.id;
    row.innerHTML = `
      <div class="row-thumb">${u.logo ? `<img src="${u.logo}" onerror="this.style.display='none'" />` : '↑'}</div>
      <div class="update-info">
        <div class="update-name">${esc(u.name)}</div>
        <div class="update-versions">
          <span class="version-old">v${esc(u.installedVersion)}</span>
          <span style="color:var(--muted)">→</span>
          <span class="version-new">v${esc(u.latestVersion)}</span>
          ${u.filesize ? `<span>· ${fmtBytes(u.filesize)}</span>` : ''}
        </div>
        <div class="update-date">${new Date(u.latestDate).toLocaleDateString()}</div>
      </div>
      <div class="update-actions">
        <button class="update-btn ${btnClass}" ${state === 'downloading' || state === 'extracting' ? 'disabled' : ''}>${btnText}</button>
      </div>`;
    row.querySelector('.update-btn').addEventListener('click', () => updateSingleMod(u.id));
    body.appendChild(row);
  });
}

async function checkAllUpdates() {
  if (!S.apiKey) { alert('Set your mod.io API key in Settings first.'); showView('settings'); return; }
  if (!S.installed.length) { setStatus('No mods installed to check'); return; }
  const btn = document.getElementById('btn-check-updates');
  btn.textContent = '↻ Checking…'; btn.disabled = true;
  setStatus(`Checking ${S.installed.length} mods…`, 'loading');
  const res = await api.checkUpdates({ apiKey: S.apiKey });
  btn.textContent = '↻ Check for updates'; btn.disabled = false;
  if (!res.ok) { setStatus('Update check failed', 'error'); return; }
  S.updates = res.updates;
  S.updating = {};
  const badge = document.getElementById('updates-badge');
  badge.style.display = S.updates.length ? 'inline' : 'none';
  badge.textContent = S.updates.length;
  setStatus(S.updates.length ? `${S.updates.length} update${S.updates.length !== 1 ? 's' : ''} available` : 'All mods up to date ✓');
  renderUpdatesView();
}

async function updateSingleMod(modId) {
  S.updating[modId] = 'downloading';
  renderUpdatesView();
  setStatus('Updating…', 'loading');
  const res = await api.updateMod({ modId, apiKey: S.apiKey });
  if (res.ok) {
    S.updating[modId] = 'done';
    S.installed = (await api.getConfig()).installed;
    setTimeout(() => {
      S.updates = S.updates.filter(u => u.id !== modId);
      const badge = document.getElementById('updates-badge');
      badge.style.display = S.updates.length ? 'inline' : 'none';
      badge.textContent = S.updates.length;
      renderUpdatesView();
    }, 1500);
    setStatus('Updated ✓');
  } else {
    S.updating[modId] = 'error';
    setStatus('Update failed: ' + res.error, 'error');
    renderUpdatesView();
  }
}

async function updateAllMods() {
  for (const u of S.updates.filter(u => S.updating[u.id] !== 'done')) {
    await updateSingleMod(u.id);
  }
}

// ── Sort / Filter ─────────────────────────────────────────────────────────────
function setSort(s) {
  S.sort = s; S.page = 1;
  document.getElementById('sort-dropdown').style.display = 'none';
  loadMods();
}

function buildFilterTags() {
  const tags = ['Avatars', 'Levels', 'Guns', 'Melee', 'Utilities', 'Cosmetics', 'Audio', 'NPCs', 'Spawnables', 'Code Mods', 'Misc'];
  const list = document.getElementById('filter-tag-list');
  list.innerHTML = '';
  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'filter-tag-btn' + (S.tag === tag ? ' active' : '');
    btn.innerHTML = `<span class="filter-check">${S.tag === tag ? '✓' : ''}</span>${tag}`;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      S.tag = S.tag === tag ? '' : tag;
      S.page = 1;
      document.getElementById('filter-dropdown').style.display = 'none';
      updateFilterBtn();
      loadMods();
    });
    list.appendChild(btn);
  });
}

function clearFilter() {
  S.tag = ''; S.page = 1;
  document.getElementById('filter-dropdown').style.display = 'none';
  updateFilterBtn();
  loadMods();
}

function updateFilterBtn() {
  const btn = document.getElementById('btn-filter');
  btn.textContent = S.tag ? `Filter: ${S.tag}` : 'Filter';
  btn.style.color = S.tag ? 'var(--accent2)' : '';
  btn.style.borderColor = S.tag ? 'var(--accent2)' : '';
}

function renderProfiles() {
  const list = document.getElementById('profiles-list');
  if (!S.profiles.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-title">No profiles yet</div><div class="empty-sub">Create a profile to save and share your mod loadout</div></div>`;
    return;
  }
  list.innerHTML = '';
  S.profiles.forEach(p => {
    const isActive = p.id === S.activeProfileId;
    const chips = p.mods.slice(0, 5).map(m => `<span class="profile-chip">${esc(m.name)}</span>`).join('');
    const more = p.mods.length > 5 ? `<span class="profile-chip more">+${p.mods.length - 5} more</span>` : '';
    const card = document.createElement('div');
    card.className = 'profile-card' + (isActive ? ' is-active' : '');
    card.innerHTML = `
      <div class="profile-card-top">
        <div class="profile-avatar">${p.name.slice(0, 2).toUpperCase()}</div>
        <div class="profile-info">
          <div class="profile-name">${esc(p.name)} ${isActive ? '<span class="profile-active-badge">Active</span>' : ''}</div>
          ${p.desc ? `<div class="profile-desc">${esc(p.desc)}</div>` : ''}
          <div class="profile-meta"><span>${p.mods.length} mod${p.mods.length !== 1 ? 's' : ''}</span><span>${new Date(p.created).toLocaleDateString()}</span></div>
        </div>
      </div>
      <div class="profile-chips">${chips}${more}</div>
      <div class="profile-actions">
        ${!isActive ? `<button class="toolbar-btn primary" data-action="activate">Apply Profile</button>` : `<button class="toolbar-btn" disabled style="color:var(--green)">✓ Active</button>`}
        <button class="toolbar-btn" data-action="sync">Sync Downloads</button>
        <button class="toolbar-btn" data-action="share">Share</button>
        <button class="toolbar-btn" data-action="update">Update</button>
        <button class="toolbar-btn danger" data-action="delete">Delete</button>
      </div>`;

    // Hook events using data-attributes to avoid null errors
    const syncBtn = card.querySelector('[data-action="sync"]');
    if (syncBtn) syncBtn.onclick = () => syncProfileMods(p);

    const activateBtn = card.querySelector('[data-action="activate"]');
    if (activateBtn) activateBtn.onclick = () => activateProfile(p.id);

    const shareBtn = card.querySelector('[data-action="share"]');
    if (shareBtn) shareBtn.onclick = () => openShareModal(p.id);

    const updateBtn = card.querySelector('[data-action="update"]');
    if (updateBtn) updateBtn.onclick = () => updateProfile(p.id);

    const deleteBtn = card.querySelector('[data-action="delete"]');
    if (deleteBtn) deleteBtn.onclick = () => deleteProfile(p.id);

    list.appendChild(card);
  });
}

function openCreateProfileModal() {
  document.getElementById('new-profile-name').value = '';
  document.getElementById('new-profile-desc').value = '';
  document.getElementById('snapshot-count').textContent = S.installed.length;
  openModal('modal-create-profile');
}

async function createProfile() {
  const name = document.getElementById('new-profile-name').value.trim();
  if (!name) { alert('Please enter a profile name.'); return; }

  // Snapshot currently installed mods (from the Library list)
  const mods = document.getElementById('profile-snapshot-current').checked
    ? S.installed.map(m => ({ id: m.id, name: m.name, logo: m.logo || '' }))
    : [];

  const newProfile = {
    id: 'p_' + Date.now(),
    name,
    desc: document.getElementById('new-profile-desc').value.trim(),
    mods,
    created: Date.now()
  };

  S.profiles.push(newProfile);

  // Save to disk
  await api.setConfig('profiles', S.profiles);

  closeModal('modal-create-profile');
  renderProfiles(); // This forces the UI to refresh
  setStatus(`Profile "${name}" created`);
}

async function syncProfileMods(profile) {
  if (!S.apiKey) { alert("Set API Key first"); return; }

  const modsToDownload = profile.mods || [];
  let startedCount = 0;

  for (const pMod of modsToDownload) {
    const isInstalled = S.installed.some(i => i.id === pMod.id);
    const isDownloading = S.installing[pMod.id];

    if (!isInstalled && !isDownloading) {
      S.installing[pMod.id] = { status: 'queued', progress: 0 };
      startedCount++;

      api.installMod({ mod: { id: pMod.id, name: pMod.name }, apiKey: S.apiKey }).then(res => {
        if (res.ok) {
          api.getConfig().then(cfg => {
            S.installed = cfg.installed || [];
            updateInstalledBadge();
          });
        }
        delete S.installing[pMod.id];
      });
    }
  }

  if (startedCount > 0) {
    setStatus(`Downloading ${startedCount} mods to Library...`, 'loading');
  }
}

async function activateProfile(profileId) {
  const profile = S.profiles.find(p => p.id === profileId);
  if (!profile) return;

  setStatus(`Applying Profile "${profile.name}"...`, 'loading');

  // Trigger the backend wipe-and-copy
  const res = await api.applyProfile({ profileId });

  if (res.ok) {
    S.activeProfileId = profileId;
    renderProfiles();
    setStatus(`Profile "${profile.name}" is now active!`);
  } else {
    setStatus('Error: ' + res.error, 'error');
  }
}

async function updateProfile(profileId) {
  const profile = S.profiles.find(p => p.id === profileId); if (!profile) return;
  if (!confirm(`Update "${profile.name}" with your current ${S.installed.length} mods?`)) return;
  profile.mods = S.installed.map(m => ({ id: m.id, name: m.name, logo: m.logo || '' }));
  await api.setConfig('profiles', S.profiles);
  renderProfiles();
  setStatus(`Profile "${profile.name}" updated`);
}

async function deleteProfile(profileId) {
  const profile = S.profiles.find(p => p.id === profileId); if (!profile) return;
  if (!confirm(`Delete profile "${profile.name}"?`)) return;
  S.profiles = S.profiles.filter(p => p.id !== profileId);
  if (S.activeProfileId === profileId) { S.activeProfileId = null; await api.setConfig('activeProfileId', null); }
  await api.setConfig('profiles', S.profiles);
  renderProfiles();
  setStatus('Profile deleted');
}

// ── Share ─────────────────────────────────────────────────────────────────────
function openShareModal(profileId) {
  const profile = S.profiles.find(p => p.id === profileId); if (!profile) return;
  S._shareTarget = profile;
  const code = btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, name: profile.name, desc: profile.desc, mods: profile.mods.map(m => ({ id: m.id, name: m.name })) }))));
  document.getElementById('share-modal-title').textContent = `Share — ${profile.name}`;
  document.getElementById('share-code-text').value = code;
  document.getElementById('btn-copy-code').textContent = 'Copy';
  document.getElementById('btn-copy-code').classList.remove('copied');
  document.getElementById('share-mod-list').innerHTML = profile.mods.map(m =>
    `<div class="share-mod-item">${m.logo ? `<img class="share-mod-thumb" src="${m.logo}" />` : '<div class="share-mod-thumb" style="display:flex;align-items:center;justify-content:center">🦴</div>'}<span class="share-mod-name">${esc(m.name)}</span></div>`
  ).join('') || '<div style="font-size:12px;color:var(--muted);padding:8px">No mods in this profile</div>';
  openModal('modal-share-profile');
}

function copyShareCode() {
  navigator.clipboard.writeText(document.getElementById('share-code-text').value).then(() => {
    const btn = document.getElementById('btn-copy-code');
    btn.textContent = 'Copied!'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

function exportProfileFile() {
  if (!S._shareTarget) return;
  const blob = new Blob([JSON.stringify({ v: 1, name: S._shareTarget.name, desc: S._shareTarget.desc, mods: S._shareTarget.mods }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = S._shareTarget.name.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.bonemm'; a.click();
  URL.revokeObjectURL(url);
}

function openImportModal() {
  document.getElementById('import-code-text').value = '';
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-error').style.display = 'none';
  openModal('modal-import-profile');
}

function previewImportCode() {
  const val = document.getElementById('import-code-text').value.trim();
  const preview = document.getElementById('import-preview');
  const error = document.getElementById('import-error');
  if (!val) { preview.style.display = 'none'; error.style.display = 'none'; return; }
  try {
    const p = parseShareCode(val);
    error.style.display = 'none';
    preview.style.display = 'block';
    preview.textContent = `"${p.name}" — ${p.mods.length} mod${p.mods.length !== 1 ? 's' : ''}${p.desc ? ` · ${p.desc}` : ''}`;
  } catch {
    preview.style.display = 'none';
    error.style.display = 'block';
    error.textContent = 'Invalid profile code.';
  }
}

function parseShareCode(code) {
  let parsed;
  try { parsed = JSON.parse(decodeURIComponent(escape(atob(code)))); } catch { parsed = JSON.parse(code); }
  if (!parsed.name || !Array.isArray(parsed.mods)) throw new Error('Invalid');
  return parsed;
}

// ---> UPDATED IMPORT LOGIC HERE <---
async function importProfile() {
  const code = document.getElementById('import-code-text').value.trim();
  let parsed;
  try { parsed = parseShareCode(code); }
  catch { document.getElementById('import-error').style.display = 'block'; document.getElementById('import-error').textContent = 'Invalid profile code.'; return; }

  let name = parsed.name;
  if (S.profiles.find(p => p.name === name)) name += ' (imported)';

  const newProfile = { id: 'p_' + Date.now(), name, desc: parsed.desc || '', mods: parsed.mods, created: Date.now(), imported: true };
  S.profiles.push(newProfile);
  await api.setConfig('profiles', S.profiles);

  closeModal('modal-import-profile');
  setStatus(`Imported "${name}"`);

  // Automatically trigger downloads of missing mods upon successful import
  syncProfileMods(newProfile);
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function saveApiKey() {
  const key = document.getElementById('api-key-field').value.trim();
  if (!key) { setStatus('No API key', 'error'); return; }
  S.apiKey = key;
  await api.setConfig('apiKey', key);
  setStatus('API key saved ✓');
}

async function testConnection() {
  const key = document.getElementById('api-key-field').value.trim() || S.apiKey;
  const btn = document.getElementById('btn-test-key');
  btn.textContent = 'Testing…'; btn.disabled = true;
  const res = await api.testConnection(key);
  btn.textContent = 'Test'; btn.disabled = false;
  document.getElementById('conn-status').innerHTML = res.ok
    ? `<span style="color:var(--green)">✓ Connected — ${esc(res.gameName)}</span>`
    : `<span style="color:var(--red)">✗ ${esc(res.error || 'Invalid key')}</span>`;
}

async function openFolderDialog() {
  const p = await api.openFolderDialog();
  if (p) { S.modFolder = p; document.getElementById('folder-field').value = p; setStatus('Mod folder set'); }
}

async function openExeDialog() {
  const p = await api.openExeDialog(); // Calls the native Windows file picker
  if (p) {
    S.exePath = p;
    await api.setConfig('exePath', p);
    document.getElementById('exe-field').value = p;
    setStatus('BONELAB.exe path saved ✓');
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); }
function fmtBytes(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B'; }

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  const cfg = await api.getConfig();
  S.apiKey = cfg.apiKey || '';
  S.modFolder = cfg.modFolder || '';
  S.exePath = cfg.exePath || '';
  S.installed = cfg.installed || [];
  S.profiles = cfg.profiles || [];
  S.activeProfileId = cfg.activeProfileId || null;

  if (S.apiKey) document.getElementById('api-key-field').value = S.apiKey;
  if (S.modFolder) document.getElementById('folder-field').value = S.modFolder;
  if (S.exePath) document.getElementById('exe-field').value = S.exePath;

  wireEvents();
  updateInstalledBadge();
  showView('installed');

  api.onInstallProgress(({ modId, status, progress }) => {
    S.installing[modId] = { status, progress };
    if (S.updates.find(u => u.id === modId)) {
      S.updating[modId] = status;
      if (S.currentView === 'updates') renderUpdatesView();
    }
    refreshRow(modId);
    if (S.selectedMod?.id === modId) renderDetail(S.selectedMod);
  });

  // --- ADD THIS BLOCK RIGHT HERE ---
  // Wait 1 second (1000ms), then fade out the blur and loading text
  setTimeout(() => {
    const overlay = document.getElementById('startup-overlay');
    if (overlay) {
      overlay.classList.add('fade-out');
      // Completely hide it after the 0.5s CSS transition finishes
      setTimeout(() => { overlay.style.display = 'none'; }, 500);
    }
  }, 1000);
}

init();

