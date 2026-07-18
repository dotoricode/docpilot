const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu, clipboard, nativeTheme, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { fork } = require('child_process');
const http = require('http');
const nodeNet = require('net');
const Store = require('./store');
const { isFileUrlForPath, normalizeExternalUrl } = require('./shared/core/app-navigation');
const { canonicalizeRoot, isPathInside } = require('./shared/core/bridge-security');
const { createUpdateController } = require('./shared/core/update-controller');

if (process.env.DOCPILOT_USER_DATA_DIR) {
  app.setPath('userData', process.env.DOCPILOT_USER_DATA_DIR);
}
app.setName('DocPilot');
process.title = 'DocPilot';

const store = new Store();
const DEFAULT_BRIDGE_PORT = 7474;
const BRIDGE_PORT_SEARCH_LIMIT = 200;
const BRIDGE_FORCE_KILL_DELAY_MS = 1200;
let bridgePort = DEFAULT_BRIDGE_PORT;
let bridgeProc = null;
const bridgeProcesses = new Set();
const bridgeProcessesByPort = new Map();
let startWin = null;
let editorWin = null;
let switchingFolder = false;
let appQuitting = false;
let activeRoot = '';
let devWatchersStarted = false;
let devReloadTimer = null;
let devBridgeTimer = null;
let updateController = null;
const devWatchMtimes = new Map();
const devWatchers = new Set();

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

function workspaceStateDir(root) {
  const key = crypto.createHash('sha256').update(root).digest('hex');
  return path.join(app.getPath('userData'), 'workspaces', key);
}

function buildBridgeEnv(port, token, root) {
  const env = {
    ...process.env,
    DOCPILOT_BRIDGE_PORT: String(port),
    DOCPILOT_BRIDGE_TOKEN: token,
    DOCPILOT_STATE_DIR: workspaceStateDir(root),
  };
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

function bridgeIsRunning(proc) {
  if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 0) return false;
  if (proc.exitCode !== null || proc.signalCode !== null) return false;
  try {
    process.kill(proc.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function reusableBridgeForRoot(root) {
  for (const proc of bridgeProcesses) {
    if (proc?._docpilotRoot === root && !proc._docpilotStopping && bridgeIsRunning(proc)) return proc;
  }
  return null;
}

function signalOwnedBridge(proc, signal) {
  if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 0) return false;
  try {
    if (process.platform !== 'win32') process.kill(-proc.pid, signal);
    else if (bridgeIsRunning(proc)) proc.kill(signal);
    else return false;
    return true;
  } catch {
    if (!bridgeIsRunning(proc)) return false;
    try {
      proc.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
}

function signalOwnedTerminalGroups(proc, signal) {
  for (const pid of Array.from(proc?._docpilotTerminalGroups?.values?.() || [])) {
    if (!Number.isInteger(pid) || pid <= 1 || pid === proc.pid || pid === process.pid) continue;
    try {
      if (process.platform !== 'win32') process.kill(-pid, signal);
      else process.kill(pid, signal);
    } catch {}
  }
}

function signalOwnedAgentGroups(proc, signal) {
  for (const pid of Array.from(proc?._docpilotAgentGroups?.values?.() || [])) {
    if (!Number.isInteger(pid) || pid <= 1 || pid === proc.pid || pid === process.pid) continue;
    try {
      if (process.platform !== 'win32') process.kill(-pid, signal);
      else process.kill(pid, signal);
    } catch {}
  }
}

function forgetOwnedBridge(proc) {
  const waitingForForceKill = Boolean(proc?._docpilotStopping && proc?._docpilotForceTimer);
  if (!waitingForForceKill) bridgeProcesses.delete(proc);
  if (bridgeProcessesByPort.get(proc?._docpilotPort) === proc) {
    bridgeProcessesByPort.delete(proc._docpilotPort);
  }
  if (!waitingForForceKill && proc?._docpilotForceTimer) {
    clearTimeout(proc._docpilotForceTimer);
    proc._docpilotForceTimer = null;
  }
  if (bridgeProc === proc) bridgeProc = null;
}

function stopOwnedBridge(proc = bridgeProc) {
  if (!proc || proc._docpilotStopping) return;
  proc._docpilotStopping = true;
  if (bridgeProcessesByPort.get(proc._docpilotPort) === proc) {
    bridgeProcessesByPort.delete(proc._docpilotPort);
  }
  if (bridgeProc === proc) bridgeProc = null;

  // Keep the already-unreferenced IPC channel open during graceful shutdown.
  // A terminal may have been created by an in-flight request just before quit;
  // its process-group notification must still reach this backup tracker.
  signalOwnedTerminalGroups(proc, 'SIGTERM');
  signalOwnedAgentGroups(proc, 'SIGTERM');
  signalOwnedBridge(proc, 'SIGTERM');
  proc._docpilotForceTimer = setTimeout(() => {
    proc._docpilotForceTimer = null;
    // The bridge may already have exited while a shell or agent descendant
    // ignored SIGTERM, so target the detached process group unconditionally.
    signalOwnedTerminalGroups(proc, 'SIGKILL');
    signalOwnedAgentGroups(proc, 'SIGKILL');
    signalOwnedBridge(proc, 'SIGKILL');
    try { if (proc.connected) proc.disconnect(); } catch {}
    forgetOwnedBridge(proc);
  }, BRIDGE_FORCE_KILL_DELAY_MS);
  proc._docpilotForceTimer.unref?.();
}

function stopAllOwnedBridges() {
  for (const proc of Array.from(bridgeProcesses)) stopOwnedBridge(proc);
}

function forceStopAllOwnedBridges() {
  for (const proc of Array.from(bridgeProcesses)) {
    signalOwnedBridge(proc, 'SIGKILL');
    signalOwnedTerminalGroups(proc, 'SIGKILL');
    signalOwnedAgentGroups(proc, 'SIGKILL');
  }
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
  for (let port = DEFAULT_BRIDGE_PORT; port < DEFAULT_BRIDGE_PORT + BRIDGE_PORT_SEARCH_LIMIT; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error('사용 가능한 docpilot bridge 포트를 찾지 못했습니다.');
}

function startBridge(root, port) {
  if (appQuitting) throw new Error('앱 종료 중에는 문서 브리지를 시작할 수 없습니다.');
  activeRoot = root;
  const token = crypto.randomBytes(32).toString('base64url');
  const child = fork(getBridgePath(), ['--root', root], {
    env: buildBridgeEnv(port, token, root),
    stdio: 'ignore',
    detached: true,
  });
  child._docpilotPort = port;
  child._docpilotRoot = root;
  child._docpilotToken = token;
  child._docpilotTerminalGroups = new Map();
  child._docpilotAgentGroups = new Map();
  bridgeProcesses.add(child);
  bridgeProcessesByPort.set(port, child);
  bridgeProc = child;
  child.on('message', message => {
    const id = typeof message?.id === 'string' ? message.id : '';
    const pid = Number(message?.pid);
    if (!id || !Number.isInteger(pid) || pid <= 1 || pid === child.pid || pid === process.pid) return;
    if (message?.type === 'terminal-group-started') child._docpilotTerminalGroups.set(id, pid);
    if (message?.type === 'terminal-group-stopped' && child._docpilotTerminalGroups.get(id) === pid) {
      child._docpilotTerminalGroups.delete(id);
    }
    if (message?.type === 'agent-group-started') child._docpilotAgentGroups.set(id, pid);
    if (message?.type === 'agent-group-stopped' && child._docpilotAgentGroups.get(id) === pid) {
      child._docpilotAgentGroups.delete(id);
    }
  });
  child.on('exit', () => {
    if (!child._docpilotStopping) {
      signalOwnedBridge(child, 'SIGKILL');
      signalOwnedTerminalGroups(child, 'SIGKILL');
      signalOwnedAgentGroups(child, 'SIGKILL');
    }
    forgetOwnedBridge(child);
  });
  // fork() creates an IPC pipe even with stdio: 'ignore'. Unreference that pipe
  // as well as the child process so it cannot keep Electron alive during quit.
  child.channel?.unref?.();
  child.unref();
  return child;
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
  if (appQuitting) return;
  clearTimeout(devReloadTimer);
  devReloadTimer = setTimeout(() => {
    devReloadTimer = null;
    if (appQuitting) return;
    console.log(`[dev] reload: ${reason}`);
    reloadWindow(startWin);
    reloadWindow(editorWin);
  }, 120);
}

function scheduleDevBridgeRestart(reason) {
  if (appQuitting) return;
  clearTimeout(devBridgeTimer);
  devBridgeTimer = setTimeout(async () => {
    devBridgeTimer = null;
    if (appQuitting || !activeRoot || !editorWin || editorWin.isDestroyed()) return;
    console.log(`[dev] restart bridge: ${reason}`);
    try {
      const targetWin = editorWin;
      const root = activeRoot;
      const previousProc = targetWin._docpilotBridgeProc || null;
      const previousPort = targetWin._docpilotBridgePort || bridgePort;
      if (previousProc) {
        stopOwnedBridge(previousProc);
        await waitForOwnedBridgeExit(previousProc, BRIDGE_FORCE_KILL_DELAY_MS + 250);
      }
      if (appQuitting || targetWin.isDestroyed()) return;
      const nextPort = await isPortAvailable(previousPort) ? previousPort : await findBridgePort();
      if (appQuitting || targetWin.isDestroyed()) return;
      const nextProc = startBridge(root, nextPort);
      bridgePort = nextPort;
      targetWin._docpilotBridgePort = nextPort;
      targetWin._docpilotBridgeProc = nextProc;
      targetWin._docpilotBridgeToken = nextProc._docpilotToken;
      const ready = await waitForBridgeRoot(root, nextPort, nextProc._docpilotToken);
      if (ready && !targetWin.isDestroyed()) loadEditorShell(targetWin);
      else console.warn('[dev] bridge restart did not become ready; keeping current window state');
    } catch (error) {
      console.warn(`[dev] bridge restart failed: ${error.message}`);
    }
  }, 180);
}

function waitForOwnedBridgeExit(proc, timeoutMs) {
  if (!bridgeIsRunning(proc)) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.removeListener('exit', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    proc.once('exit', finish);
  });
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
    devWatchers.add(watcher);
    watcher.once('close', () => devWatchers.delete(watcher));
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
    devWatchers.add(watcher);
    watcher.once('close', () => devWatchers.delete(watcher));
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

function stopDevWatchers() {
  clearTimeout(devReloadTimer);
  clearTimeout(devBridgeTimer);
  devReloadTimer = null;
  devBridgeTimer = null;
  for (const watcher of Array.from(devWatchers)) {
    try { watcher.close(); } catch {}
  }
  devWatchers.clear();
  devWatchMtimes.clear();
  devWatchersStarted = false;
}

function getBridgeStatus(port = bridgePort, token = '') {
  return new Promise(resolve => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/ping',
      headers: token ? { 'X-DocPilot-Token': token } : {},
    }, res => {
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

function waitForBridgeRoot(root, port = bridgePort, token = '', timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const check = async () => {
      const status = await getBridgeStatus(port, token);
      if (status?.root === root) { resolve(true); return; }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(check, 120);
    };
    check();
  });
}

function configureAboutPanel() {
  app.setAboutPanelOptions({
    applicationName: 'DocPilot',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: `Copyright © ${new Date().getFullYear()} DocPilot`,
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
      { name: 'Supported Documents', extensions: ['md', 'markdown', 'mdown', 'txt', 'text', 'yaml', 'yml', 'json', 'js', 'mjs', 'cjs'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
}

function normalizeWorkspaceRoot(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const root = canonicalizeRoot(candidate);
  if (!root) return null;
  try {
    return fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

// ── Windows ──────────────────────────────────────────────
function normalizeThemePreference(value) {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function storedThemePreference() {
  return normalizeThemePreference(store.get('themePreference'));
}

function resolveEffectiveTheme(preference) {
  if (preference === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return preference;
}

function windowBackground(theme) {
  return theme === 'light' ? '#f3f3f4' : '#0c0d0f';
}

function applyNativeTheme(preference) {
  nativeTheme.themeSource = normalizeThemePreference(preference);
}

function createStartWindow() {
  const preference = storedThemePreference();
  const effectiveTheme = resolveEffectiveTheme(preference);
  applyNativeTheme(preference);
  const win = new BrowserWindow({
    width: 920,
    height: 620,
    minWidth: 760,
    minHeight: 520,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: windowBackground(effectiveTheme),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win._docpilotWindowKind = 'start';
  startWin = win;
  installStartNavigationGuard(win);
  win.loadFile('start.html', { query: { theme: effectiveTheme, preference } });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (startWin === win) startWin = null;
  });
  return win;
}

function createEditorWindow(root, openFileRel = '', port = bridgePort, bridge = null) {
  const preference = storedThemePreference();
  const effectiveTheme = resolveEffectiveTheme(preference);
  applyNativeTheme(preference);
  const win = new BrowserWindow({
    width: 1440,
    height: 1024,
    minWidth: 760,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 15 },
    backgroundColor: windowBackground(effectiveTheme),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win._docpilotWindowKind = 'editor';
  win._docpilotRoot = root;
  // Diagnostics now live in private per-workspace app data rather than in the
  // project. Keep that exact state directory revealable from Settings while
  // continuing to reject arbitrary renderer-supplied local paths.
  win._docpilotAllowedRoots = new Set([root, workspaceStateDir(root)]);
  win._docpilotBridgePort = port;
  win._docpilotBridgeProc = bridge || bridgeProcessesByPort.get(port) || null;
  win._docpilotBridgeToken = win._docpilotBridgeProc?._docpilotToken || '';
  win._docpilotOpenFileRel = openFileRel || '';
  editorWin = win;
  installEditorNavigationGuard(win);
  loadEditorShell(win);
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => {
    editorWin = win;
    bridgePort = win._docpilotBridgePort || bridgePort;
    bridgeProc = win._docpilotBridgeProc || null;
    activeRoot = win._docpilotRoot || activeRoot;
  });
  win.on('closed', () => {
    if (editorWin === win) editorWin = null;
    stopBridgeWhenUnused(win._docpilotBridgeProc, win);
    if (!switchingFolder) {
      const remaining = BrowserWindow.getAllWindows().filter(item => item !== win && !item.isDestroyed());
      if (!remaining.length) app.quit();
    }
  });
  return win;
}

function stopBridgeWhenUnused(proc, closedWindow = null) {
  if (!proc || proc._docpilotStopping) return;
  const stillUsed = BrowserWindow.getAllWindows().some(win => (
    win !== closedWindow
    && !win.isDestroyed()
    && win._docpilotBridgeProc === proc
  ));
  if (!stillUsed) stopOwnedBridge(proc);
}

function isEditorShellUrl(rawUrl) {
  return isFileUrlForPath(rawUrl, getReactRendererPath());
}

function isStartShellUrl(rawUrl) {
  return isFileUrlForPath(rawUrl, path.join(__dirname, 'start.html'));
}

function getReactRendererPath() {
  return path.join(__dirname, 'dist', 'renderer', 'index.html');
}

function loadEditorShell(win) {
  if (!win || win.isDestroyed()) return;
  const openFileRel = win._docpilotOpenFileRel || '';
  const port = win._docpilotBridgePort || bridgePort;
  const reactRendererPath = getReactRendererPath();
  const preference = storedThemePreference();
  const effectiveTheme = resolveEffectiveTheme(preference);
  if (!fs.existsSync(reactRendererPath)) {
    dialog.showErrorBox(
      'DocPilot renderer missing',
      `React renderer bundle was not found:\n${reactRendererPath}\n\nRun npm run renderer:build before starting the app.`
    );
    return;
  }
  win.loadFile(reactRendererPath, {
    query: {
      port: String(port),
      token: String(win._docpilotBridgeToken || ''),
      theme: effectiveTheme,
      preference,
      ...(openFileRel ? { open: openFileRel } : {}),
    },
  });
}

function installEditorNavigationGuard(win) {
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (isEditorShellUrl(targetUrl)) return;
    event.preventDefault();
    const externalUrl = normalizeExternalUrl(targetUrl);
    if (externalUrl) shell.openExternal(externalUrl).catch(() => {});
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalUrl(url);
    if (externalUrl) shell.openExternal(externalUrl).catch(() => {});
    return { action: 'deny' };
  });
}

function installStartNavigationGuard(win) {
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (isStartShellUrl(targetUrl)) return;
    event.preventDefault();
    const externalUrl = normalizeExternalUrl(targetUrl);
    if (externalUrl) shell.openExternal(externalUrl).catch(() => {});
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalUrl(url);
    if (externalUrl) shell.openExternal(externalUrl).catch(() => {});
    return { action: 'deny' };
  });
}

function closeEditorForSwitch(win = editorWin) {
  if (!win || win.isDestroyed()) return Promise.resolve();
  switchingFolder = true;
  const old = win;
  return new Promise(resolve => {
    old.once('closed', () => {
      switchingFolder = false;
      resolve();
    });
    old.close();
  });
}

async function openFolder(folderPath, openFileRel = '', owner = BrowserWindow.getFocusedWindow()) {
  const ownerWindow = owner && !owner.isDestroyed() ? owner : null;
  const root = normalizeWorkspaceRoot(folderPath);
  if (!root) throw new Error('유효한 문서 폴더가 아닙니다.');
  try {
    if (ownerWindow?._docpilotWindowKind === 'editor') {
      await closeEditorForSwitch(ownerWindow);
    }
    addRecent(root);
    await sleep(120);
    if (appQuitting) throw new Error('앱이 종료 중입니다.');
    let nextBridgeProc = reusableBridgeForRoot(root);
    const nextBridgePort = nextBridgeProc?._docpilotPort || await findBridgePort();
    if (appQuitting) throw new Error('앱이 종료 중입니다.');
    const startedBridge = !nextBridgeProc;
    if (!nextBridgeProc) nextBridgeProc = startBridge(root, nextBridgePort);
    bridgePort = nextBridgePort;
    const ready = await waitForBridgeRoot(root, nextBridgePort, nextBridgeProc._docpilotToken);
    if (appQuitting) {
      if (startedBridge) stopOwnedBridge(nextBridgeProc);
      throw new Error('앱이 종료 중입니다.');
    }
    if (!ready) {
      if (startedBridge) stopOwnedBridge(nextBridgeProc);
      throw new Error('문서 브리지를 시작하지 못했습니다.');
    }
    const win = createEditorWindow(root, openFileRel, nextBridgePort, nextBridgeProc);
    if (ownerWindow?._docpilotWindowKind === 'start' && !ownerWindow.isDestroyed()) {
      ownerWindow.close();
    }
    checkForUpdates();
  } catch (error) {
    const hasWindow = BrowserWindow.getAllWindows().some(win => !win.isDestroyed());
    if (!appQuitting && !hasWindow) createStartWindow();
    throw error;
  }
}

async function openFilePath(filePath, owner = BrowserWindow.getFocusedWindow()) {
  let canonicalFile;
  try { canonicalFile = fs.realpathSync.native(String(filePath || '')); }
  catch { throw new Error('유효한 문서 파일이 아닙니다.'); }
  if (!fs.statSync(canonicalFile).isFile()) throw new Error('유효한 문서 파일이 아닙니다.');
  const root = path.dirname(canonicalFile);
  const rel = path.basename(canonicalFile);
  await openFolder(root, rel, owner);
}

async function closeFolder() {
  const win = focusedEditorWindow();
  if (!win) return;
  await closeEditorForSwitch(win);
  createStartWindow();
}

// ── IPC ─────────────────────────────────────────────────
function trustedIpcWindow(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  const frame = event.senderFrame;
  if (!frame || !event.sender.mainFrame || frame !== event.sender.mainFrame) return null;
  const senderUrl = frame.url;
  const trusted = win._docpilotWindowKind === 'start'
    ? isStartShellUrl(senderUrl)
    : win._docpilotWindowKind === 'editor' && isEditorShellUrl(senderUrl);
  return trusted ? win : null;
}

function handleTrustedIpc(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const win = trustedIpcWindow(event);
    if (!win) throw new Error(`Blocked untrusted IPC sender for ${channel}`);
    return handler(event, win, ...args);
  });
}

handleTrustedIpc('get-recent', () => getRecent());
handleTrustedIpc('get-app-version', () => app.getVersion());
handleTrustedIpc('get-launch-preferences', () => {
  const themePreference = storedThemePreference();
  return {
    appName: 'DocPilot',
    version: app.getVersion(),
    themePreference,
    effectiveTheme: resolveEffectiveTheme(themePreference),
  };
});

handleTrustedIpc('open-folder-dialog', async (_event, win) => {
  return chooseFolder(win);
});

handleTrustedIpc('choose-workspace-folder', async (_event, win) => {
  const selected = await chooseFolder(win);
  const root = selected ? normalizeWorkspaceRoot(selected) : null;
  if (root && win._docpilotWindowKind === 'editor') win._docpilotAllowedRoots?.add(root);
  return root;
});

handleTrustedIpc('choose-instruction-file', async (_event, win) => {
  const filePath = await chooseFile(win);
  if (!filePath) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return { path: filePath, name: path.basename(filePath), content };
});

handleTrustedIpc('open-folder', async (_event, win, folderPath) => {
  await openFolder(folderPath, '', win);
});

handleTrustedIpc('remove-recent', (_event, _win, folderPath) => {
  const list = getRecent().filter(p => p !== folderPath);
  store.set('recentFolders', list);
  buildAppMenu();
});

handleTrustedIpc('open-url', (_event, _win, rawUrl) => {
  const url = normalizeExternalUrl(rawUrl);
  if (!url) return false;
  return shell.openExternal(url).then(() => true, () => false);
});
handleTrustedIpc('open-local-path', async (_event, win, targetPath) => {
  if (win._docpilotWindowKind !== 'editor' || !win._docpilotRoot) return false;
  let abs;
  try {
    abs = fs.realpathSync.native(String(targetPath || ''));
  } catch {
    return false;
  }
  const allowedRoots = Array.from(win._docpilotAllowedRoots || [])
    .map(root => {
      try { return fs.realpathSync.native(root); } catch { return null; }
    })
    .filter(Boolean);
  if (!allowedRoots.some(root => isPathInside(root, abs, true))) return false;
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const error = await shell.openPath(abs);
    return !error;
  }
  shell.showItemInFolder(abs);
  return true;
});
handleTrustedIpc('copy-text', (_event, _win, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

handleTrustedIpc('window-toggle-maximize', (_event, win) => {
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

handleTrustedIpc('set-window-theme', (_event, win, requestedTheme) => {
  const preference = normalizeThemePreference(requestedTheme);
  const theme = resolveEffectiveTheme(preference);
  store.set('themePreference', preference);
  applyNativeTheme(preference);
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(windowBackground(theme));
  }
  return true;
});

handleTrustedIpc('get-update-state', () => {
  return getUpdateController().getState();
});

handleTrustedIpc('download-update', async (_event, win) => {
  if (win._docpilotWindowKind !== 'editor') throw new Error('업데이트는 작업 화면에서 내려받을 수 있습니다.');
  return getUpdateController().download();
});

handleTrustedIpc('open-downloaded-update', async (_event, win) => {
  if (win._docpilotWindowKind !== 'editor') throw new Error('업데이트는 작업 화면에서 열 수 있습니다.');
  return getUpdateController().openDownloaded();
});

// ── Application menu ───────────────────────────────────
function focusedEditorWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused?._docpilotWindowKind === 'editor') return focused;
  if (editorWin && !editorWin.isDestroyed()) return editorWin;
  return null;
}

function sendEditorCommand(command) {
  const win = focusedEditorWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('menu-command', command);
}

async function menuOpenFolder() {
  const owner = BrowserWindow.getFocusedWindow();
  const folderPath = await chooseFolder(owner);
  if (folderPath) await openFolder(folderPath, '', owner);
}

async function menuOpenFile() {
  const owner = BrowserWindow.getFocusedWindow();
  const filePath = await chooseFile(owner);
  if (filePath) await openFilePath(filePath, owner);
}

function recentMenuItems() {
  const recent = getRecent();
  if (!recent.length) return [{ label: 'No Recent Folders', enabled: false }];
  const items = recent.map(folderPath => ({
    label: path.basename(folderPath) || folderPath,
    sublabel: folderPath,
    click: () => openFolder(folderPath, '', BrowserWindow.getFocusedWindow()),
  }));
  items.push({ type: 'separator' });
  items.push({ label: 'Clear Recently Opened', click: () => clearRecent() });
  return items;
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  configureAboutPanel();
  const template = [
    ...(isMac ? [{
      label: 'DocPilot',
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
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createStartWindow() },
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
const GITHUB_REPO = 'dotoricode/docpilot';
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

function broadcastUpdateState(state) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win._docpilotWindowKind === 'editor') {
      win.webContents.send('update-state', state);
    }
  }
}

function getUpdateController() {
  if (updateController) return updateController;
  updateController = createUpdateController({
    repository: GITHUB_REPO,
    currentVersion: app.getVersion(),
    arch: process.arch,
    downloadsDirectory: () => app.getPath('downloads'),
    fetchRelease: async () => {
      const response = await net.fetch(GITHUB_LATEST_RELEASE_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `DocPilot/${app.getVersion()}`,
        },
      });
      if (!response.ok) throw new Error(`업데이트 확인에 실패했습니다 (${response.status}).`);
      return response.json();
    },
    fetchAsset: (url, options) => net.fetch(url, options),
    openPath: filePath => shell.openPath(filePath),
    onState: broadcastUpdateState,
  });
  return updateController;
}

async function checkForUpdates() {
  if (process.platform !== 'darwin') return;
  await getUpdateController().check().catch(() => {});
}

// ── App lifecycle ────────────────────────────────────────
function initialWorkspaceFromArgs() {
  const candidate = process.argv
    .slice(app.isPackaged ? 1 : 2)
    .map(value => path.resolve(value))
    .find(value => fs.existsSync(value) && fs.statSync(value).isDirectory());
  return candidate || '';
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
  }
  buildAppMenu();
  startDevWatchers();
  powerMonitor.on('shutdown', () => {
    appQuitting = true;
    stopDevWatchers();
    stopAllOwnedBridges();
  });
  const initialWorkspace = initialWorkspaceFromArgs();
  if (initialWorkspace) await openFolder(initialWorkspace);
  else createStartWindow();
});

app.on('before-quit', () => {
  appQuitting = true;
  stopDevWatchers();
  stopAllOwnedBridges();
});

app.on('will-quit', () => {
  stopDevWatchers();
  stopAllOwnedBridges();
});

app.on('window-all-closed', () => {
  if (switchingFolder) return;
  activeRoot = '';
  stopDevWatchers();
  stopAllOwnedBridges();
  app.quit();
});

process.once('exit', forceStopAllOwnedBridges);
