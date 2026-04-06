const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bonemm', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (k, v) => ipcRenderer.invoke('set-config', { key: k, value: v }),
  openExeDialog: () => ipcRenderer.invoke('open-exe-dialog'),
  openInExplorer: (p) => ipcRenderer.invoke('open-in-explorer', p),
  fetchMods: (o) => ipcRenderer.invoke('fetch-mods', o),
  testConnection: (k) => ipcRenderer.invoke('test-connection', k),
  installMod: (o) => ipcRenderer.invoke('install-mod', o),
  uninstallMod: (id) => ipcRenderer.invoke('uninstall-mod', id),
  toggleMod: (o) => ipcRenderer.invoke('toggle-mod', o),
  openModFolder: (id) => ipcRenderer.invoke('open-mod-folder', id),
  checkUpdates: (o) => ipcRenderer.invoke('check-updates', o),
  updateMod: (o) => ipcRenderer.invoke('update-mod', o),
  applyProfile: (o) => ipcRenderer.invoke('apply-profile', o),
  onInstallProgress: (cb) => {
    ipcRenderer.on('install-progress', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('install-progress');
  },
});
