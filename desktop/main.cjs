// Orbital desktop shell (Electron).
// Runs the real Orbital server in a Node utility process (embedded PostgreSQL in the user's
// app-data folder, bound to 127.0.0.1) and shows it in a hardened window.
const { app, BrowserWindow, Menu, Notification, Tray, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme, safeStorage, shell, utilityProcess } = require("electron");
const crypto = require("node:crypto");
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
const settingsFile = path.join(userData, "desktop-settings.json");
fs.mkdirSync(logDir, { recursive: true });

const appRoot = path.join(__dirname, "..");
const serverEntry = path.join(appRoot, "desktop-build", "server", "main.mjs");
const staticDir = path.join(appRoot, "dist");

let win = null;
let server = null;
let port = 0;
let quitting = false;
let tray = null;
// Lets this app (and only this app) start a password reset on the local server: there's no email or
// administrator on a desktop install. Never sent to the window.
const desktopToken = crypto.randomBytes(32).toString("hex");
// Orbital Pro (14-day trial, then paid features). Off until payments are live (docs/BILLING.md);
// turning it on starts everyone's trial from that release.
const PRO_ENABLED = false;
let dueCount = 0;

// ── Desktop settings: keep running in the background (so reminders arrive), open at login ──
const DEFAULT_SETTINGS = { background: true, openAtLogin: false, toldAboutBackground: false };
function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) }; } catch { return { ...DEFAULT_SETTINGS }; }
}
let settings = readSettings();
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings)); } catch { /* ignore */ }
}
const loginSupported = process.platform === "darwin" || process.platform === "win32";
function applyLoginItem() {
  if (!loginSupported || !app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, args: ["--hidden"] });
}
/** Started by the computer at login: stay in the menu bar / tray instead of opening a window. */
function startedHidden() {
  if (process.argv.includes("--hidden")) return true;
  try { return isMac && app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; }
}

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
      ORBITAL_DESKTOP_TOKEN: desktopToken,
      ORBITAL_BILLING: process.env.ORBITAL_BILLING || (PRO_ENABLED ? "on" : "off"),
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

let hiddenStart = false;
function showWindow(pathname) {
  if (!win) createWindow();
  hiddenStart = false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (typeof pathname === "string" && pathname.startsWith("/") && !pathname.startsWith("//")) {
    const send = () => win?.webContents.send("orbital:navigate", pathname);
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send); else send();
  }
}

// ── orbital:// links: "Activate in Orbital" on the purchase page opens Settings → Plan with the key ──
const LICENSE_KEY = /^ORB-[A-Za-z0-9_-]{8,120}-[A-Za-z0-9_-]{16,64}$/;
let pendingLink = null;
function handleLink(link) {
  let u;
  try { u = new URL(link); } catch { return; }
  if (u.protocol !== "orbital:") return;
  const key = u.searchParams.get("key") ?? "";
  const target = (u.hostname === "activate" || u.pathname.replace(/^\/+/, "") === "activate") && LICENSE_KEY.test(key)
    ? `/settings?license=${encodeURIComponent(key)}#plan` : "/";
  if (!server || !port) { pendingLink = target; return; } // opened before Orbital finished starting
  showWindow(target);
}

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
  win.once("ready-to-show", () => { if (!hiddenStart) win.show(); });
  win.on("close", (e) => {
    saveWindowState();
    // Closing the window keeps Orbital running in the menu bar / tray, so reminders still arrive.
    if (!quitting && settings.background) {
      e.preventDefault();
      win.hide();
      if (!settings.toldAboutBackground && Notification.isSupported()) {
        saveSettings({ toldAboutBackground: true });
        new Notification({ title: "Orbital is still running", body: `Reminders will still reach you. Quit from the ${isMac ? "menu bar" : "tray"} icon, or turn this off in Settings.`, silent: true }).show();
      }
    }
  });
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
  // geolocation: only when someone clicks "Use my location" for the sidebar weather (the OS may still ask).
  const ALLOWED = new Set(["clipboard-sanitized-write", "media", "display-capture", "mediaKeySystem", "geolocation"]);
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

const fromApp = (e) => typeof e.senderFrame?.url === "string" && e.senderFrame.url.startsWith(origin());
const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
// A system notification (the web Notification API isn't allowed in the window); clicking it opens the page.
ipcMain.handle("orbital:notify", (e, n) => {
  if (!fromApp(e) || !n || !Notification.isSupported()) return false;
  // You're looking at Orbital: the in-app toast is enough.
  if (win && win.isVisible() && !win.isMinimized() && win.isFocused()) return false;
  const note = new Notification({ title: clip(n.title, 120) || "Orbital", body: clip(n.body, 400), silent: false });
  const link = clip(n.link, 300);
  note.on("click", () => showWindow(link.startsWith("/") ? link : "/reminders"));
  note.show();
  return true;
});
// Reminders due: the dock / taskbar badge, and the count beside the menu bar icon.
ipcMain.handle("orbital:set-badge", (e, n) => {
  if (!fromApp(e)) return;
  dueCount = Math.max(0, Math.min(999, Math.floor(Number(n) || 0)));
  try { app.setBadgeCount(dueCount); } catch { /* not supported here */ }
  if (process.platform === "win32" && win) {
    win.setOverlayIcon(dueCount ? nativeImage.createFromPath(path.join(__dirname, "tray", "badge.png")) : null, dueCount ? `${dueCount} reminders due` : "");
  }
  updateTray();
});
// Forgot password: everything is on this computer, so reset it here. Opens "choose a new password".
ipcMain.handle("orbital:reset-password", async (e, email) => {
  if (!fromApp(e) || typeof email !== "string" || email.length > 200) throw new Error("Not allowed");
  const r = await fetch(`${origin()}/api/auth/password/desktop-reset`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-orbital-request": "1", "x-orbital-desktop-token": desktopToken },
    body: JSON.stringify({ email }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || typeof body.path !== "string" || !body.path.startsWith("/reset-password?token=")) return { error: body.error || "Couldn't reset the password." };
  win?.loadURL(origin() + body.path);
  return { ok: true };
});
ipcMain.handle("orbital:get-settings", () => ({ background: !!settings.background, openAtLogin: !!settings.openAtLogin, loginSupported }));
ipcMain.handle("orbital:set-settings", (e, patch) => {
  if (!fromApp(e) || !patch || typeof patch !== "object") throw new Error("Not allowed");
  const next = {};
  if (typeof patch.background === "boolean") next.background = patch.background;
  if (typeof patch.openAtLogin === "boolean") next.openAtLogin = patch.openAtLogin;
  saveSettings(next);
  applyLoginItem();
  updateTray();
  return { background: !!settings.background, openAtLogin: !!settings.openAtLogin, loginSupported };
});

// ── Menu bar (macOS) / system tray (Windows, Linux) ──
function trayIcon() {
  if (isMac) { const i = nativeImage.createFromPath(path.join(__dirname, "tray", "trayTemplate.png")); i.setTemplateImage(true); return i; }
  const file = process.platform === "win32" && !nativeTheme.shouldUseDarkColorsForSystemUI ? "tray-dark.png" : "tray.png";
  return nativeImage.createFromPath(path.join(__dirname, "tray", file)).resize({ width: 16, height: 16 });
}
function updateTray() {
  if (!tray) return;
  const due = dueCount ? `${dueCount} reminder${dueCount === 1 ? "" : "s"} due` : "No reminders due";
  tray.setToolTip(`Orbital · ${due}`);
  if (isMac) tray.setTitle(dueCount ? String(dueCount) : "");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Orbital", click: () => showWindow() },
    { label: due, enabled: dueCount > 0, click: () => showWindow("/reminders") },
    { label: "New Reminder…", click: () => showWindow("/reminders") },
    { type: "separator" },
    { label: "Keep Running When Window Is Closed", type: "checkbox", checked: !!settings.background, click: (i) => { saveSettings({ background: i.checked }); updateTray(); } },
    ...(loginSupported && app.isPackaged ? [{ label: "Open at Login", type: "checkbox", checked: !!settings.openAtLogin, click: (i) => { saveSettings({ openAtLogin: i.checked }); applyLoginItem(); updateTray(); } }] : []),
    { type: "separator" },
    { label: "Quit Orbital", click: () => app.quit() },
  ]));
}
function createTray() {
  try {
    tray = new Tray(trayIcon());
    // Windows and Linux: a click opens Orbital (the menu is on right-click). macOS shows the menu.
    if (!isMac) tray.on("click", () => showWindow());
    nativeTheme.on("updated", () => tray?.setImage(trayIcon()));
    updateTray();
  } catch { tray = null; /* no tray on this desktop */ }
}

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

app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => typeof a === "string" && a.startsWith("orbital://"));
  if (link) handleLink(link); else showWindow();
});
// macOS delivers links here (also when the link starts Orbital).
app.on("open-url", (e, link) => { e.preventDefault(); handleLink(link); });
if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient("orbital", process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient("orbital");

if (process.platform === "win32") app.setAppUserModelId("app.orbital.desktop");

app.whenReady().then(async () => {
  buildMenu();
  hiddenStart = startedHidden();
  applyLoginItem();
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox("Orbital couldn't start", `${e.message}\n\nLog: ${path.join(logDir, "server.log")}`);
    app.quit();
    return;
  }
  createWindow();
  createTray();
  // Started by clicking an orbital:// link (Windows, Linux pass it as an argument).
  const startLink = process.argv.find((a) => typeof a === "string" && a.startsWith("orbital://"));
  if (startLink) handleLink(startLink);
  if (pendingLink) { const t = pendingLink; pendingLink = null; showWindow(t); }
  checkForUpdates();
  app.on("activate", () => showWindow());
});

// With "keep running" off, closing the window quits (on macOS the app stays in the Dock, as Mac apps do).
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
