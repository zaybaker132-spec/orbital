// Minimal, explicit bridge: the web app gets desktop status and can set the API key.
// The key goes to the main process (OS-keychain-backed storage), never over HTTP.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orbitalDesktop", {
  isDesktop: true,
  status: () => ipcRenderer.invoke("orbital:status"),
  setApiKey: (key) => ipcRenderer.invoke("orbital:set-api-key", key),
  openDataFolder: () => ipcRenderer.invoke("orbital:open-data-folder"),
  // Reminders: a system notification, the dock/taskbar badge, and opening a page from a notification or the tray.
  notify: (n) => ipcRenderer.invoke("orbital:notify", n),
  setBadge: (count) => ipcRenderer.invoke("orbital:set-badge", count),
  onNavigate: (cb) => {
    const h = (_e, pathname) => { if (typeof pathname === "string") cb(pathname); };
    ipcRenderer.on("orbital:navigate", h);
    return () => ipcRenderer.removeListener("orbital:navigate", h);
  },
  // Keep running when the window is closed; open at login.
  getSettings: () => ipcRenderer.invoke("orbital:get-settings"),
  setSettings: (patch) => ipcRenderer.invoke("orbital:set-settings", patch),
});
