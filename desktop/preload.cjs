// Minimal, explicit bridge: the web app gets desktop status and can set the API key.
// The key goes to the main process (OS-keychain-backed storage), never over HTTP.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orbitalDesktop", {
  isDesktop: true,
  status: () => ipcRenderer.invoke("orbital:status"),
  setApiKey: (key) => ipcRenderer.invoke("orbital:set-api-key", key),
  openDataFolder: () => ipcRenderer.invoke("orbital:open-data-folder"),
});
