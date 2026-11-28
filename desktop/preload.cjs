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
  // Updates: { state: "available" | "ready", version } when there's a newer Orbital.
  getUpdate: () => ipcRenderer.invoke("orbital:get-update"),
  onUpdate: (cb) => {
    const h = (_e, u) => cb(u);
    ipcRenderer.on("orbital:update", h);
    return () => ipcRenderer.removeListener("orbital:update", h);
  },
  installUpdate: () => ipcRenderer.invoke("orbital:install-update"),
  // Keep running when the window is closed; open at login.
  // Forgot password on this computer: opens "choose a new password" for that account.
  resetPassword: (email) => ipcRenderer.invoke("orbital:reset-password", email),
  getSettings: () => ipcRenderer.invoke("orbital:get-settings"),
  setSettings: (patch) => ipcRenderer.invoke("orbital:set-settings", patch),
});
