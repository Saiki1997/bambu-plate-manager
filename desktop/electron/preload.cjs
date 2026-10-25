const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bambuDesktop", {
  info: () => ipcRenderer.invoke("app:info"),
  loadSession: () => ipcRenderer.invoke("session:load"),
  saveSession: (project) => ipcRenderer.invoke("session:save", project),
  flushSession: (project) => ipcRenderer.sendSync("session:flush", project),
  saveImage: (payload) => ipcRenderer.invoke("image:save", payload),
  readImage: (id) => ipcRenderer.invoke("image:read", id),
  deleteImages: (ids) => ipcRenderer.invoke("image:delete", ids),
  readCatalogue: () => ipcRenderer.invoke("catalogue:read"),
  saveExport: (name, data) => ipcRenderer.invoke("export:save", { name, data }),
  chooseDataDir: () => ipcRenderer.invoke("data:choose"),
  openDataDir: () => ipcRenderer.invoke("data:open"),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  restoreBackup: (name) => ipcRenderer.invoke("backups:restore", name),
  checkForUpdate: () => ipcRenderer.invoke("update:check"),
  openRelease: (url) => ipcRenderer.invoke("update:open", url),
  readSetting: (name) => ipcRenderer.invoke("settings:read", name),
  writeSetting: (name, value) => ipcRenderer.invoke("settings:write", name, value),
  log: (message) => ipcRenderer.invoke("log:write", message),
});
