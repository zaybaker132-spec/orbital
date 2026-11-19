// Orbital desktop shell (Electron).
// Runs the real Orbital server in a Node utility process (embedded PostgreSQL in the user's
// app-data folder, bound to 127.0.0.1) and shows it in a hardened window.
const { app, BrowserWindow, Menu, clipboard, desktopCapturer, dialog, ipcMain, nativeTheme, safeStorage, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const isMac = process.platform === "darwin";
app.setName("Orbital");
nativeTheme.themeSource = "dark";

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const userData = app.getPath("userData");
const dataDir = path.join(userData, "data");
const logDir = path.join(userData, "logs");
const keyFile = path.join(userData, "ai-key.bin");
const stateFile = path.join(userData, "window-state.json");
fs.mkdirSync(logDir, { recursive: true });

const appRoot = path.join(__dirname, "..");
const serverEntry = path.join(appRoot, "desktop-build", "server", "main.mjs");
const staticDir = path.join(appRoot, "dist");

let win = null;
let server = null;
let port = 0;
let quitting = false;

// ── API key: encrypted with the OS keychain (safeStorage), never sent over HTTP ──
function readApiKey() {
  try {
    if (!fs.existsSync(keyFile) || !safeStorage.isEncryptionAvailable()) return "";
    return safeStorage.decryptString(fs.readFileSync(keyFile));
  } catch {
    return "";
  }
}
function writeApiKey(key) {
  if (!key) return fs.rmSync(keyFile, { force: true });
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is not available on this system.");
  fs.writeFileSync(keyFile, safeStorage.encryptString(key), { mode: 0o600 });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function startServer() {
  port = await freePort();
  const apiKey = readApiKey();
  const log = fs.createWriteStream(path.join(logDir, "server.log"), { flags: "a" });
  log.write(`\n--- ${new Date().toISOString()} starting Orbital ${app.getVersion()} on port ${port}\n`);
  server = utilityProcess.fork(serverEntry, [], {
    serviceName: "Orbital server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      ORBITAL_DESKTOP: "1",
      ORBITAL_DATA_DIR: dataDir,
      ORBITAL_STATIC_DIR: staticDir,
      COOKIE_SECURE: "false",
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey, AI_PROVIDER: "anthropic" } : {}),
    },
  });
  server.stdout?.on("data", (d) => log.write(d));
  server.stderr?.on("data", (d) => log.write(d));
  server.on("exit", (code) => {
    log.write(`server exited with code ${code}\n`);
    server = null;
    if (!quitting && code !== 0) {
      dialog.showErrorBox("Orbital stopped unexpectedly", `The Orbital server exited (code ${code}). Details are in:\n${path.join(logDir, "server.log")}`);
    }
  });
  // Wait for the health endpoint.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (!server) throw new Error("The server exited during startup.");
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The server did not start within 60 seconds.");
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    s.once("exit", () => resolve());
    s.kill();
    setTimeout(resolve, 5000);
  });
}

function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return { width: 1440, height: 900 }; }
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(stateFile, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* ignore */ }
}

const origin = () => `http://127.0.0.1:${port}`;

function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1440, height: st.height || 900, minWidth: 980, minHeight: 640,
    backgroundColor: "#000000",
    show: false,
    title: "Orbital",
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (st.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.on("close", saveWindowState);
  win.on("closed", () => { win = null; });

  // Only the local Orbital origin loads in the window; everything else opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(origin())) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  // Right-click menu: spelling suggestions, cut/copy/paste, links. (Electron shows none by default.)
  win.webContents.on("context-menu", (_e, p) => {
    const items = [];
    if (p.misspelledWord) {
      for (const w of p.dictionarySuggestions.slice(0, 6)) items.push({ label: w, click: () => win.webContents.replaceMisspelling(w) });
      if (!p.dictionarySuggestions.length) items.push({ label: "No spelling suggestions", enabled: false });
      items.push({ label: "Add to Dictionary", click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: "separator" });
    }
    if (p.linkURL && /^https?:\/\//.test(p.linkURL)) {
      items.push({ label: "Open Link in Browser", click: () => shell.openExternal(p.linkURL) }, { label: "Copy Link", click: () => clipboard.writeText(p.linkURL) }, { type: "separator" });
    }
    if (p.isEditable) {
      items.push({ role: "undo", enabled: p.editFlags.canUndo }, { role: "redo", enabled: p.editFlags.canRedo }, { type: "separator" },
        { role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy }, { role: "paste", enabled: p.editFlags.canPaste },
        { role: "pasteAndMatchStyle", enabled: p.editFlags.canPaste }, { type: "separator" }, { role: "selectAll" });
    } else if (p.selectionText.trim()) {
      items.push({ role: "copy" }, { type: "separator" }, { role: "selectAll" });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Only Orbital's own pages get camera, microphone and screen access (for Meetings); everything else is denied.
  const ses = win.webContents.session;
  const fromOrbital = (url) => typeof url === "string" && url.startsWith(origin());
  const ALLOWED = new Set(["clipboard-sanitized-write", "media", "display-capture", "mediaKeySystem"]);
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(ALLOWED.has(permission) && fromOrbital(wc.getURL())));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => ALLOWED.has(permission) && fromOrbital(requestingOrigin + "/"));
  // Screen sharing: the system picker where available (macOS 15+), otherwise the primary screen.
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => cb(sources[0] ? { video: sources[0] } : {})).catch(() => cb({}));
  }, { useSystemPicker: true });
  win.loadURL(origin());
}

ipcMain.handle("orbital:status", () => ({
  version: app.getVersion(),
  platform: process.platform,
  hasApiKey: !!readApiKey(),
  secureStorage: safeStorage.isEncryptionAvailable(),
  dataDir,
}));
ipcMain.handle("orbital:set-api-key", async (e, key) => {
  if (!e.senderFrame.url.startsWith(origin())) throw new Error("Not allowed");
  if (key !== null && (typeof key !== "string" || key.length < 20 || key.length > 400)) throw new Error("That doesn't look like an API key.");
  writeApiKey(key ? key.trim() : null);
  // Restart the server so the new key takes effect; the session cookie survives (same data dir).
  await stopServer();
  const oldPort = port;
  await startServer();
  if (win) {
    if (port !== oldPort) win.loadURL(origin());
    else win.reload();
  }
  return { ok: true };
});
ipcMain.handle("orbital:open-data-folder", () => shell.openPath(userData));

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Conversation", accelerator: "Alt+N", click: () => win?.loadURL(origin() + "/") },
        { label: "Command Palette", accelerator: "CmdOrCtrl+K", click: () => win?.webContents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: [isMac ? "meta" : "control"] }) },
        { type: "separator" },
        { label: "Open Data Folder", click: () => shell.openPath(userData) },
        { label: "Show Server Log", click: () => shell.openPath(path.join(logDir, "server.log")) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function checkForUpdates() {
  // Active only in packaged builds published with an update feed (see electron-builder.yml → publish).
  if (!app.isPackaged || process.env.ORBITAL_DISABLE_UPDATES) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.on("error", () => { /* no feed configured, offline, etc. */ });
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch { /* updater unavailable */ }
}

app.on("second-instance", () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
  buildMenu();
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox("Orbital couldn't start", `${e.message}\n\nLog: ${path.join(logDir, "server.log")}`);
    app.quit();
    return;
  }
  createWindow();
  checkForUpdates();
  app.on("activate", () => { if (!win) createWindow(); });
});

app.on("window-all-closed", () => { if (!isMac) app.quit(); });
app.on("before-quit", async (e) => {
  if (quitting) return;
  quitting = true;
  if (server) {
    e.preventDefault();
    await stopServer();
    app.quit();
  }
});
