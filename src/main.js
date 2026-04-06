const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const player = require('node-wav-player'); // New: Audio Player

app.setPath('userData', path.join(app.getPath('appData'), 'bonemm'));

let store;

async function initStore() {
  const storePath = path.join(app.getPath('userData'), 'bonemm-config.json');
  const defaults = {
    apiKey: '', modFolder: defaultModFolder(), exePath: '',
    installed: [], profiles: [], activeProfileId: null,
  };
  let data;
  try { data = JSON.parse(fs.readFileSync(storePath, 'utf8')); }
  catch { data = {}; }
  data = Object.assign({}, defaults, data);
  store = {
    _path: storePath,
    _data: data,
    get(k) { return this._data[k]; },
    set(k, v) { this._data[k] = v; fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2)); },
  };
}

function getLibraryFolder() {
  const libPath = path.join(app.getPath('userData'), 'Library');
  if (!fs.existsSync(libPath)) fs.mkdirSync(libPath, { recursive: true });
  return libPath;
}

// Updated: Function to play the startup sound from the assets folder
function playStartupSound() {
  // Use process.resourcesPath if packaged as an .exe, otherwise use __dirname for dev
  const soundPath = app.isPackaged
    ? path.join(process.resourcesPath, '..', 'assets', 'startup.wav')
    : path.join(__dirname, 'assets', 'startup.wav');

  if (fs.existsSync(soundPath)) {
    player.play({ path: soundPath }).catch(err => {
      console.error("Could not play startup sound:", err);
    });
  } else {
    console.warn("Startup sound not found at:", soundPath);
  }
}
function defaultModFolder() {
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || '', '..', 'LocalLow', 'Stress Level Zero', 'BONELAB', 'Mods');
  return path.join(process.env.HOME || '', '.local', 'share', 'BONELAB', 'Mods');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 720, minWidth: 800, minHeight: 560,
    backgroundColor: '#1a1c23',
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  await initStore();
  playStartupSound(); // Trigger the sound here
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// --- Keep all your existing IPC Handlers and Helpers (fetchJson, downloadFile, etc.) below this line ---

ipcMain.handle('get-config', () => ({
  apiKey: store.get('apiKey'),
  modFolder: store.get('modFolder'),
  exePath: store.get('exePath') || '',
  installed: store.get('installed') || [],
  profiles: store.get('profiles') || [],
  activeProfileId: store.get('activeProfileId') || null,
}));

ipcMain.handle('set-config', (_, { key, value }) => { store.set(key, value); return true; });

ipcMain.handle('apply-profile', async (_, { profileId }) => {
  const modFolder = store.get('modFolder');
  const libraryFolder = getLibraryFolder();
  const profiles = store.get('profiles') || [];
  const profile = profiles.find(p => p.id === profileId);

  if (!profile) return { ok: false, error: 'Profile not found' };

  try {
    // 1. Wipe current Mods folder
    if (fs.existsSync(modFolder)) {
      const files = fs.readdirSync(modFolder);
      for (const file of files) {
        fs.rmSync(path.join(modFolder, file), { recursive: true, force: true });
      }
    } else {
      fs.mkdirSync(modFolder, { recursive: true });
    }

    // 2. Copy mods from Library to game Mods folder
    for (const pMod of profile.mods) {
      const source = path.join(libraryFolder, String(pMod.id));
      const safeName = (pMod.name || 'mod').replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_').trim();
      const target = path.join(modFolder, safeName);

      if (fs.existsSync(source)) {
        fs.cpSync(source, target, { recursive: true });
      }
    }

    store.set('activeProfileId', profileId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('open-exe-dialog', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Select BONELAB.exe',
    buttonLabel: 'Select Executable',
    filters: [{ name: 'Executables', extensions: ['exe'] }],
    properties: ['openFile']
  });

  if (!r.canceled && r.filePaths.length > 0) {
    return r.filePaths[0];
  }
  return null;
});

ipcMain.handle('open-in-explorer', (_, p) => {
  if (p) shell.openPath(p);
});

ipcMain.handle('fetch-mods', async (_, { apiKey, sort, search, tag, offset, limit }) => {
  const gameId = 3809;
  const sortMap = { new: '-date_added', rating: '-rating', downloads: '-downloads_total' };
  const sortField = sortMap[sort] || '-popular';
  let url = `https://api.mod.io/v1/games/${gameId}/mods?api_key=${apiKey}&_limit=${limit || 20}&_offset=${offset || 0}&_sort=${sortField}`;
  if (search) url += `&_q=${encodeURIComponent(search)}`;
  if (tag) url += `&tags=${encodeURIComponent(tag)}`;
  try { return { ok: true, data: await fetchJson(url) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('test-connection', async (_, apiKey) => {
  try {
    const d = await fetchJson(`https://api.mod.io/v1/games/3809?api_key=${apiKey}`);
    return { ok: true, gameName: d.name };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('install-mod', async (event, { mod, apiKey }) => {
  const modFolder = store.get('modFolder');
  if (!modFolder) return { ok: false, error: 'No mod folder set.' };
  const { fileUrl, fileSize } = await getBestFileUrl(mod.id, apiKey);
  if (!fileUrl) return { ok: false, error: 'No download URL found.' };
  return doInstall(event, mod, apiKey, fileUrl, fileSize);
});

ipcMain.handle('update-mod', async (event, { modId, apiKey }) => {
  const installed = store.get('installed') || [];
  const mod = installed.find(i => i.id === modId);
  const { fileUrl, fileSize, version } = await getBestFileUrl(modId, apiKey);
  const fakeMod = { ...mod, modfile: { version, filesize: fileSize, download: { binary_url: fileUrl } } };
  return doInstall(event, fakeMod, apiKey, fileUrl, fileSize, true);
});

async function getBestFileUrl(modId, apiKey) {
  const gameId = 3809;
  try {
    const d = await fetchJson(`https://api.mod.io/v1/games/${gameId}/mods/${modId}/files?api_key=${apiKey}&_limit=20`);
    const files = d?.data || [];

    // Sort newest first
    files.sort((a, b) => b.date_added - a.date_added);

    // 1. Try to find a file specifically marked for Windows (status 1 = Live)
    let f = files.find(f => f.platforms?.some(p => p.platform === 'windows' && p.status === 1));

    // 2. Fallback to files with no platform restriction (often universal)
    if (!f) f = files.find(f => !f.platforms || f.platforms.length === 0);

    // 3. Last resort: just the newest file
    if (!f && files.length) f = files[0];

    if (f) return { fileUrl: f.download?.binary_url, fileSize: f.filesize, version: f.version };
  } catch (e) {
    console.error("Error fetching files:", e);
  }
  return {};
}

// Updated doInstall with the "Stream Finish" fix for ADM-ZIP
async function doInstall(event, mod, apiKey, rawUrl, fileSize, isUpdate = false) {
  const libraryFolder = getLibraryFolder();
  const dlUrl = rawUrl.includes('api_key=') ? rawUrl : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'api_key=' + apiKey;

  const tmpPath = path.join(libraryFolder, `temp_${mod.id}.zip`);
  const extractDir = path.join(libraryFolder, String(mod.id));

  try {
    event.sender.send('install-progress', { modId: mod.id, status: 'downloading', progress: 0 });

    // Wait for the download and the FILE WRITE to completely finish
    await downloadFile(dlUrl, tmpPath, p => {
      event.sender.send('install-progress', { modId: mod.id, status: 'downloading', progress: p });
    });

    // Verification: Ensure the file actually exists and isn't 0 bytes
    if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
      throw new Error("Download failed: File is empty or missing.");
    }

    event.sender.send('install-progress', { modId: mod.id, status: 'extracting', progress: 90 });

    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(tmpPath);
    zip.extractAllTo(extractDir, true);

    // Cleanup temp file
    fs.unlinkSync(tmpPath);

    // Update internal store
    const installed = store.get('installed') || [];
    const idx = installed.findIndex(i => i.id === mod.id);
    const entry = {
      id: mod.id, name: mod.name,
      logo: mod.logo?.thumb_320x180 || '',
      version: mod.modfile?.version || '1.0',
      filesize: fileSize || 0,
      dir: extractDir,
      date: Date.now(),
      enabled: true,
    };
    if (idx >= 0) installed[idx] = entry; else installed.push(entry);
    store.set('installed', installed);

    event.sender.send('install-progress', { modId: mod.id, status: 'done', progress: 100 });
    return { ok: true };
  } catch (e) {
    if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch { }
    event.sender.send('install-progress', { modId: mod.id, status: 'error', progress: 0 });
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('uninstall-mod', async (_, modId) => {
  const installed = store.get('installed') || [];
  const mod = installed.find(i => i.id === modId);
  if (mod && mod.dir && fs.existsSync(mod.dir)) fs.rmSync(mod.dir, { recursive: true, force: true });
  store.set('installed', installed.filter(i => i.id !== modId));
  return { ok: true };
});

ipcMain.handle('toggle-mod', async (_, { modId, enabled }) => {
  const installed = store.get('installed') || [];
  const mod = installed.find(i => i.id === modId);
  const disabledDir = mod.dir.replace(/\.disabled$/, '') + '.disabled';
  const enabledDir = mod.dir.replace(/\.disabled$/, '');
  try {
    if (!enabled && fs.existsSync(enabledDir)) { fs.renameSync(enabledDir, disabledDir); mod.dir = disabledDir; }
    if (enabled && fs.existsSync(disabledDir)) { fs.renameSync(disabledDir, enabledDir); mod.dir = enabledDir; }
    mod.enabled = enabled;
    store.set('installed', installed);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('open-mod-folder', (_, modId) => {
  const installed = store.get('installed') || [];
  const mod = installed.find(i => i.id === modId);
  const dir = (mod?.dir || store.get('modFolder') || '').replace(/\.disabled$/, '');
  if (dir) shell.openPath(dir);
});

ipcMain.handle('check-updates', async (_, { apiKey }) => {
  const installed = store.get('installed') || [];
  const updates = [];
  for (const mod of installed) {
    try {
      const { fileUrl, version } = await getBestFileUrl(mod.id, apiKey);
      const gameId = 3809;
      const d = await fetchJson(`https://api.mod.io/v1/games/${gameId}/mods/${mod.id}/files?api_key=${apiKey}&_limit=20`);
      const files = d?.data || [];
      files.sort((a, b) => b.date_added - a.date_added);
      let latest = files[0];
      if (version !== mod.version || (latest.date_added * 1000) > mod.date + 60000) {
        updates.push({ id: mod.id, name: mod.name, logo: mod.logo || '', installedVersion: mod.version, latestVersion: version, latestDate: latest.date_added * 1000, filesize: latest.filesize });
      }
    } catch { }
  }
  return { ok: true, updates };
});

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'BoneMod/1.0' } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    client.get(url, { headers: { 'User-Agent': 'BoneMod/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(downloadFile(res.headers.location, dest, onProgress));

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(dest);

      res.on('data', chunk => {
        received += chunk.length;
        file.write(chunk);
        if (total > 0 && onProgress) onProgress(Math.round((received / total) * 100));
      });

      // CRITICAL FIX: file.end() must be called, and we must wait for 'finish'
      res.on('end', () => {
        file.end();
      });

      file.on('finish', () => {
        resolve(); // Only resolve once the file is fully saved to disk
      });

      res.on('error', e => { file.destroy(); reject(e); });
      file.on('error', reject);
    }).on('error', reject);
  });
}