const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fork } = require('child_process');
const http = require('http');
const nodeNet = require('net');
const Store = require('./store');

const store = new Store();
const DEFAULT_BRIDGE_PORT = 7474;
let bridgePort = DEFAULT_BRIDGE_PORT;
let bridgeProc = null;
let startWin = null;
let editorWin = null;
let switchingFolder = false;
let activeRoot = '';
let devWatchersStarted = false;
let devReloadTimer = null;
let devBridgeTimer = null;
const devWatchMtimes = new Map();

// ── Bridge ──────────────────────────────────────────────
function uniquePathEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function cliPathCandidates() {
  const home = os.homedir();
  return [
    path.join(home, '.npm-global', 'bin'),
    path.join(home, 'Library', 'pnpm'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/opt/local/bin',
    '/opt/local/sbin',
  ];
}

function buildBridgeEnv(port) {
  const env = { ...process.env, DOCPILOT_BRIDGE_PORT: String(port) };
  env.PATH = uniquePathEntries([
    ...(env.PATH || '').split(path.delimiter),
    ...(env.DOCPILOT_EXTRA_PATH || '').split(path.delimiter),
    ...cliPathCandidates(),
  ]).join(path.delimiter);
  return env;
}

function getBridgePath() {
  // packaged: bridge.js is in app.asar.unpacked
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'bridge.js');
  if (require('fs').existsSync(unpacked)) return unpacked;
  return path.join(__dirname, 'bridge.js');
}

function stopOwnedBridge() {
  if (bridgeProc) { bridgeProc.kill(); bridgeProc = null; }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = nodeNet.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findBridgePort() {
  for (let port = DEFAULT_BRIDGE_PORT; port < DEFAULT_BRIDGE_PORT + 30; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error('사용 가능한 docpilot bridge 포트를 찾지 못했습니다.');
}

function startBridge(root, port) {
  stopOwnedBridge();
  activeRoot = root;
  const child = fork(getBridgePath(), ['--root', root], {
    env: buildBridgeEnv(port),
    stdio: 'ignore',
  });
  bridgeProc = child;
  child.on('exit', () => {
    if (bridgeProc === child) bridgeProc = null;
  });
}

// ── Dev live reload ─────────────────────────────────────
function reloadWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win === editorWin && !isEditorShellUrl(win.webContents.getURL())) {
    loadEditorShell(win);
    return;
  }
  win.webContents.reloadIgnoringCache();
}

function scheduleDevReload(reason) {
  clearTimeout(devReloadTimer);
  devReloadTimer = setTimeout(() => {
    console.log(`[dev] reload: ${reason}`);
    reloadWindow(startWin);
    reloadWindow(editorWin);
  }, 120);
}

function scheduleDevBridgeRestart(reason) {
  clearTimeout(devBridgeTimer);
  devBridgeTimer = setTimeout(async () => {
    if (!activeRoot || !editorWin || editorWin.isDestroyed()) return;
    console.log(`[dev] restart bridge: ${reason}`);
    startBridge(activeRoot, bridgePort);
    const ready = await waitForBridgeRoot(activeRoot, bridgePort);
    if (ready) reloadWindow(editorWin);
    else console.warn('[dev] bridge restart did not become ready; keeping current window state');
  }, 180);
}

function hasDevPathChanged(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) return false;
    const prev = devWatchMtimes.get(targetPath);
    devWatchMtimes.set(targetPath, stat.mtimeMs);
    return prev == null || stat.mtimeMs !== prev;
  } catch {
    return false;
  }
}

function watchDevFile(filePath, onChange) {
  if (!fs.existsSync(filePath)) return;
  hasDevPathChanged(filePath);
  try {
    const watcher = fs.watch(filePath, () => {
      if (hasDevPathChanged(filePath)) onChange(filePath);
    });
    watcher.on('error', err => console.warn(`[dev] watcher error: ${filePath}`, err.message));
  } catch (err) {
    console.warn(`[dev] watch failed: ${filePath}`, err.message);
  }
}

function watchDevDir(targetPath, onChange, options = {}) {
  if (!fs.existsSync(targetPath)) return;
  try {
    const watcher = fs.watch(targetPath, options, (eventType, filename) => {
      if (!filename) return;
      const changedPath = path.join(targetPath, filename.toString());
      if (hasDevPathChanged(changedPath)) onChange(changedPath, eventType);
    });
    watcher.on('error', err => console.warn(`[dev] watcher error: ${targetPath}`, err.message));
  } catch (err) {
    console.warn(`[dev] watch failed: ${targetPath}`, err.message);
  }
}

function startDevWatchers() {
  if (app.isPackaged || devWatchersStarted) return;
  devWatchersStarted = true;

  for (const file of ['start.html', 'preload.js']) {
    watchDevFile(path.join(__dirname, file), () => scheduleDevReload(file));
  }
  watchDevFile(path.join(__dirname, 'bridge.js'), () => scheduleDevBridgeRestart('bridge.js'));
  watchDevDir(path.join(__dirname, 'assets'), changedPath => {
    if (changedPath && path.extname(changedPath)) scheduleDevReload(`assets/${path.basename(changedPath)}`);
  }, { recursive: true });

  console.log('[dev] live reload watching start.html, preload.js, bridge.js, assets/');
}

function getBridgeStatus(port = bridgePort) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/ping`, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function waitForBridgeRoot(root, port = bridgePort, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const check = async () => {
      const status = await getBridgeStatus(port);
      if (status?.root === root) { resolve(true); return; }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(check, 120);
    };
    check();
  });
}

// ── Recent folders ───────────────────────────────────────
function getRecent() { return store.get('recentFolders') || []; }

function addRecent(folderPath) {
  let list = getRecent().filter(p => p !== folderPath);
  list.unshift(folderPath);
  store.set('recentFolders', list.slice(0, 10));
  buildAppMenu();
}

function clearRecent() {
  store.set('recentFolders', []);
  buildAppMenu();
}

async function chooseFolder(owner) {
  const { canceled, filePaths } = await dialog.showOpenDialog(owner || BrowserWindow.getFocusedWindow(), {
    properties: ['openDirectory'],
    title: '문서 폴더 선택',
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
}

async function chooseFile(owner) {
  const { canceled, filePaths } = await dialog.showOpenDialog(owner || BrowserWindow.getFocusedWindow(), {
    properties: ['openFile'],
    title: '문서 파일 선택',
    filters: [
      { name: 'Text Documents', extensions: ['md', 'markdown', 'mdown', 'txt', 'text'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
}

// ── Windows ──────────────────────────────────────────────
function createStartWindow() {
  startWin = new BrowserWindow({
    width: 560,
    height: 420,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d0e10',
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  startWin.loadFile('start.html');
  startWin.once('ready-to-show', () => startWin.show());
  startWin.on('closed', () => { startWin = null; });
}

function createEditorWindow(root, openFileRel = '', port = bridgePort) {
  editorWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 17 },
    backgroundColor: '#07080a',
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  editorWin._docpilotOpenFileRel = openFileRel || '';
  installEditorNavigationGuard(editorWin);
  loadEditorShell(editorWin);
  editorWin.once('ready-to-show', () => editorWin.show());
  editorWin.on('closed', () => {
    editorWin = null;
    if (!switchingFolder) {
      stopOwnedBridge();
      app.quit();
    }
  });
}

function isEditorShellUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const basename = path.basename(decodeURIComponent(url.pathname));
    return basename === 'index.html';
  } catch {
    return false;
  }
}

function getReactRendererPath() {
  return path.join(__dirname, 'dist', 'renderer', 'index.html');
}

function loadEditorShell(win) {
  if (!win || win.isDestroyed()) return;
  const openFileRel = win._docpilotOpenFileRel || '';
  const reactRendererPath = getReactRendererPath();
  if (!fs.existsSync(reactRendererPath)) {
    dialog.showErrorBox(
      'DocPilot renderer missing',
      `React renderer bundle was not found:\n${reactRendererPath}\n\nRun npm run renderer:build before starting the app.`
    );
    return;
  }
  win.loadFile(reactRendererPath, {
    query: {
      port: String(bridgePort),
      ...(openFileRel ? { open: openFileRel } : {}),
    },
  });
}

function installEditorNavigationGuard(win) {
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (isEditorShellUrl(targetUrl)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(targetUrl)) shell.openExternal(targetUrl).catch(() => {});
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
}

function closeEditorForSwitch() {
  if (!editorWin) return Promise.resolve();
  switchingFolder = true;
  const old = editorWin;
  return new Promise(resolve => {
    old.once('closed', () => {
      switchingFolder = false;
      resolve();
    });
    old.close();
  });
}

async function openFolder(folderPath, openFileRel = '') {
  await closeEditorForSwitch();
  addRecent(folderPath);
  stopOwnedBridge();
  await sleep(120);
  bridgePort = await findBridgePort();
  startBridge(folderPath, bridgePort);
  await waitForBridgeRoot(folderPath, bridgePort);
  createEditorWindow(folderPath, openFileRel, bridgePort);
  if (startWin) { startWin.close(); startWin = null; }
  checkForUpdates();
}

async function openFilePath(filePath) {
  const root = path.dirname(filePath);
  const rel = path.basename(filePath);
  await openFolder(root, rel);
}

async function closeFolder() {
  if (!editorWin) return;
  await closeEditorForSwitch();
  stopOwnedBridge();
  activeRoot = '';
  createStartWindow();
}

// ── IPC ─────────────────────────────────────────────────
ipcMain.handle('get-recent', () => getRecent());
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('open-folder-dialog', async () => {
  return chooseFolder(startWin || editorWin);
});

ipcMain.handle('choose-workspace-folder', async () => {
  return chooseFolder(editorWin || BrowserWindow.getFocusedWindow());
});

ipcMain.handle('choose-instruction-file', async () => {
  const filePath = await chooseFile(startWin || editorWin);
  if (!filePath) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return { path: filePath, name: path.basename(filePath), content };
});

ipcMain.handle('open-folder', async (_, folderPath) => {
  await openFolder(folderPath);
});

ipcMain.handle('remove-recent', (_, folderPath) => {
  const list = getRecent().filter(p => p !== folderPath);
  store.set('recentFolders', list);
  buildAppMenu();
});

ipcMain.handle('open-url', (_, url) => shell.openExternal(url));
ipcMain.handle('open-local-path', async (_, targetPath) => {
  const abs = path.resolve(String(targetPath || ''));
  if (!abs || !fs.existsSync(abs)) return false;
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const error = await shell.openPath(abs);
    return !error;
  }
  shell.showItemInFolder(abs);
  return true;
});
ipcMain.handle('copy-text', (_, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

ipcMain.handle('window-toggle-maximize', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

// ── Application menu ───────────────────────────────────
function sendEditorCommand(command) {
  if (!editorWin || editorWin.isDestroyed()) return;
  editorWin.webContents.send('menu-command', command);
}

async function menuOpenFolder() {
  const folderPath = await chooseFolder(BrowserWindow.getFocusedWindow());
  if (folderPath) await openFolder(folderPath);
}

async function menuOpenFile() {
  const filePath = await chooseFile(BrowserWindow.getFocusedWindow());
  if (filePath) await openFilePath(filePath);
}

function recentMenuItems() {
  const recent = getRecent();
  if (!recent.length) return [{ label: 'No Recent Folders', enabled: false }];
  const items = recent.map(folderPath => ({
    label: path.basename(folderPath) || folderPath,
    sublabel: folderPath,
    click: () => openFolder(folderPath),
  }));
  items.push({ type: 'separator' });
  items.push({ label: 'Clear Recently Opened', click: () => clearRecent() });
  return items;
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => { if (!startWin) createStartWindow(); else startWin.focus(); } },
        { type: 'separator' },
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => menuOpenFile() },
        { label: 'Open Folder...', accelerator: 'CmdOrCtrl+Shift+O', click: () => menuOpenFolder() },
        { label: 'Open Recent', submenu: recentMenuItems() },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', enabled: true, click: () => sendEditorCommand('save') },
        { type: 'separator' },
        { label: isMac ? 'Close Folder [⌘K F]' : 'Close Folder', click: () => closeFolder() },
        { role: 'close', label: 'Close Window' },
        ...(!isMac ? [{ type: 'separator' }, { role: 'quit' }] : []),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Version check ────────────────────────────────────────
const GITHUB_REPO = 'youngsang-kwon/docpilot'; // TODO: 실제 repo로 변경

function checkForUpdates() {
  const req = net.request(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
  req.on('response', res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        const latest = (data.tag_name || '').replace(/^v/, '');
        const current = app.getVersion();
        if (latest && latest !== current && editorWin) {
          editorWin.webContents.send('update-available', { version: latest, url: data.html_url });
        }
      } catch {}
    });
  });
  req.on('error', () => {});
  req.end();
}

// ── App lifecycle ────────────────────────────────────────
app.setName('DocPilot');

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
  }
  buildAppMenu();
  startDevWatchers();
  createStartWindow();
});

app.on('window-all-closed', () => {
  if (switchingFolder) return;
  if (bridgeProc) { bridgeProc.kill(); bridgeProc = null; }
  activeRoot = '';
  app.quit();
});
