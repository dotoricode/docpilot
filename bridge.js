#!/usr/bin/env node
/**
 * bridge.js — docpilot bridge server
 * Usage: node bridge.js --root /path/to/docs
 * Requires: claude CLI in PATH (Claude Code 설치되어 있으면 됩니다)
 */
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const { buildSessionPromptPackage } = require('./prompt-package');
const { chooseContextMode } = require('./shared/core/context-policy');
const { AgentProcessManager } = require('./shared/core/agent-process-manager');
const { TerminalSessionModel } = require('./shared/core/terminal-session-model');
const {
  canonicalizeRoot,
  isAllowedLoopbackHost,
  isAllowedRendererOrigin,
  isAuthorizedBridgeRequest,
  resolveInsideRoot,
} = require('./shared/core/bridge-security');
const { ensurePrivateDirectory, writeJsonAtomic } = require('./shared/core/atomic-file');
const { movePathToRecoverableTrashAsync } = require('./shared/core/recoverable-trash');
const { fileRevision, writeExistingWorkspaceFileAtomic } = require('./shared/core/workspace-file');
const { renamePathNoClobber } = require('./shared/core/no-clobber-rename');

const requestedPort = Number(process.env.DOCPILOT_BRIDGE_PORT || 7474);
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535 ? requestedPort : 7474;
const BRIDGE_TOKEN = String(process.env.DOCPILOT_BRIDGE_TOKEN || '');
const ALLOW_UNAUTHENTICATED = process.env.DOCPILOT_ALLOW_UNAUTHENTICATED === '1';
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const MAX_ACTIVE_AGENT_TURNS = 4;
const BRIDGE_SHUTDOWN_TIMEOUT_MS = 900;
const AGENT_FORCE_KILL_DELAY_MS = 400;
const TERMINAL_FORCE_KILL_DELAY_MS = 400;
const TEST_TERMINAL_SEPARATE_GROUP = process.env.DOCPILOT_TEST_TERMINAL_SEPARATE_GROUP === '1';
let parentDisconnectRequested = false;
let handleParentDisconnect = null;
let bridgeShuttingDown = false;

// Register before synchronous startup work so a parent crash during module load
// cannot leave a detached bridge behind. The actual teardown function is wired
// after the HTTP server has been constructed.
process.once('disconnect', () => {
  if (handleParentDisconnect) handleParentDisconnect();
  else parentDisconnectRequested = true;
});

// --root 인자 파싱
const rootIdx = process.argv.indexOf('--root');
const ROOT = canonicalizeRoot(rootIdx !== -1 ? process.argv[rootIdx + 1] : process.cwd());
if (!ROOT || !fs.statSync(ROOT).isDirectory()) {
  console.error('docpilot bridge requires an existing workspace directory');
  process.exit(1);
}
if (!BRIDGE_TOKEN && !ALLOW_UNAUTHENTICATED) {
  console.error('docpilot bridge requires DOCPILOT_BRIDGE_TOKEN');
  process.exit(1);
}
const defaultStateBase = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'DocPilot')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'DocPilot')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'docpilot');
const workspaceStateKey = crypto.createHash('sha256').update(ROOT).digest('hex');
const implicitStateBase = ALLOW_UNAUTHENTICATED ? path.join(os.tmpdir(), 'docpilot-test-state') : defaultStateBase;
const STATE_DIR = path.resolve(process.env.DOCPILOT_STATE_DIR || path.join(implicitStateBase, 'workspaces', workspaceStateKey));
const INSTRUCTIONS_FILE = path.join(STATE_DIR, 'instructions.json');
const SESSIONS_FILE = path.join(STATE_DIR, 'sessions.json');
const SETTINGS_FILE = path.join(STATE_DIR, 'settings.json');
const SESSION_LOGS_DIR = path.join(STATE_DIR, 'session-logs');
const GLOBAL_DOCPILOT_DIR = defaultStateBase;
const GLOBAL_INSTRUCTION_SETS_FILE = path.join(GLOBAL_DOCPILOT_DIR, 'instruction-sets.json');
const HIDDEN_DIRS = new Set(['.git', '.docpilot', 'node_modules', '.next', 'dist', 'build', 'coverage']);
const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.adoc', '.asciidoc', '.asc', '.txt', '.text', '.yaml', '.yml', '.json', '.js', '.mjs', '.cjs']);
const FOLDER_STARTER_DOC_NAME = 'edit-me.md';

ensurePrivateDirectory(STATE_DIR);

// AsciiDoc conversion runs on a separate worker_threads thread (adoc-worker.js),
// lazily started on first request. asciidoctor.convert() is synchronous CPU work
// (~500ms for a large manual page) — running it on bridge.js's own event loop
// would stall every other request (image fetches, file listing, the project
// watch poll) for that whole time.
let asciidocWorker = null;
let asciidocWorkerReqId = 0;
const asciidocWorkerPending = new Map();

function getAsciidocWorker() {
  if (asciidocWorker) return asciidocWorker;
  asciidocWorker = new Worker(path.join(__dirname, 'adoc-worker.js'));
  asciidocWorker.on('message', msg => {
    const pending = asciidocWorkerPending.get(msg.reqId);
    if (!pending) return;
    asciidocWorkerPending.delete(msg.reqId);
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.html);
  });
  asciidocWorker.on('error', err => {
    for (const pending of asciidocWorkerPending.values()) pending.reject(err);
    asciidocWorkerPending.clear();
    asciidocWorker = null;
  });
  asciidocWorker.on('exit', () => { asciidocWorker = null; });
  return asciidocWorker;
}

function convertAsciidocInWorker(source) {
  return new Promise((resolve, reject) => {
    const reqId = ++asciidocWorkerReqId;
    asciidocWorkerPending.set(reqId, { resolve, reject });
    getAsciidocWorker().postMessage({ reqId, source });
  });
}

// Converting a large .adoc file costs ~500ms; cache by content hash so
// switching between tabs of unchanged files is instant instead of
// re-running the whole Opal parse every time.
const adocConvertCache = new Map();
const ADOC_CONVERT_CACHE_LIMIT = 20;

// AsciiDoc image::[] targets are relative to the source file's own
// directory. The converted HTML keeps that relative path as-is, which
// resolves against the renderer page's own origin instead — so we rewrite
// it here to a /workspace-asset URL resolved against the document's id.
// Antora modules keep pages and images as siblings (modules/<name>/pages/,
// modules/<name>/images/) and resolve image::[] targets against the images
// family implicitly — authors don't write an explicit imagesdir attribute.
// Non-Antora .adoc files fall back to plain file-relative resolution.
function adocImageBaseDir(docId) {
  const normalized = String(docId || '').replace(/\\/g, '/');
  const pagesIdx = normalized.lastIndexOf('/pages/');
  if (pagesIdx !== -1) return `${normalized.slice(0, pagesIdx)}/images`;
  return path.posix.dirname(normalized);
}

function rewriteAdocImageSrc(html, docId) {
  const docDir = adocImageBaseDir(docId);
  return html.replace(/(<img[^>]*\ssrc=")([^"]+)(")/g, (match, pre, src, post) => {
    if (/^(https?:|data:|\/\/)/i.test(src)) return match;
    const resolved = path.posix.normalize(docDir === '.' ? src : `${docDir}/${src}`);
    const token = BRIDGE_TOKEN ? `&token=${encodeURIComponent(BRIDGE_TOKEN)}` : '';
    return `${pre}http://127.0.0.1:${PORT}/workspace-asset?id=${encodeURIComponent(resolved)}${token}${post}`;
  });
}
const ASSETS_DIR = path.join(__dirname, 'assets');
const agentProcesses = new AgentProcessManager();
const stoppingAgentProcesses = new Set();
const terminalSessions = new Map();
const stoppingTerminalSessions = new Set();
const workspaceRoots = [];
const ASSET_TYPES = new Map([
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

// file:// 로 열린 HTML → origin이 'null'
const CORS = {
  'Access-Control-Allow-Origin':  'null',
  'Access-Control-Allow-Headers': 'Content-Type, X-DocPilot-Token',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Vary': 'Origin',
};

// Resolve only existing, non-symlink paths below the canonical workspace root.
function safeResolve(relPath) {
  return resolveInsideRoot(ROOT, relPath, { allowRoot: true });
}

function workspaceRootId(absPath) {
  const base = path.basename(absPath).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'folder';
  const hash = crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 8);
  return `ws-${base}-${hash}`;
}

function normalizeWorkspaceRootInput(inputPath) {
  const abs = canonicalizeRoot(inputPath);
  if (!abs || abs === ROOT) return null;
  try {
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }
  return abs;
}

function addWorkspaceRoot(inputPath) {
  const abs = normalizeWorkspaceRootInput(inputPath);
  if (!abs) return null;
  const existing = workspaceRoots.find(root => root.path === abs);
  if (existing) return existing;
  const root = { id: workspaceRootId(abs), name: path.basename(abs) || abs, path: abs };
  workspaceRoots.push(root);
  return root;
}

function publicWorkspaceRoots() {
  return workspaceRoots.map(root => ({ id: root.id, name: root.name, path: root.path }));
}

function removeWorkspaceRoot(id) {
  const idx = workspaceRoots.findIndex(root => root.id === id);
  if (idx === -1) return false;
  workspaceRoots.splice(idx, 1);
  return true;
}

function resolveWorkspaceFileId(fileId) {
  const id = String(fileId || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!id) return null;
  for (const root of workspaceRoots) {
    const prefix = `${root.id}/`;
    if (!id.startsWith(prefix)) continue;
    const rel = normalizeProjectRelPath(id.slice(prefix.length));
    if (!rel) return null;
    const abs = resolveInsideRoot(root.path, rel, { allowRoot: true });
    if (!abs) return null;
    return { id, abs, rel, root, isWorkspaceRoot: true };
  }
  const rel = normalizeProjectRelPath(id);
  if (!rel) return null;
  const abs = safeResolve(rel);
  if (!abs) return null;
  return { id: rel, abs, rel, root: { id: '', name: path.basename(ROOT) || ROOT, path: ROOT }, isWorkspaceRoot: false };
}

function fileIdForResolvedAbs(abs, root) {
  const rel = path.relative(root.path, abs).replace(/\\/g, '/');
  return root.id ? `${root.id}/${rel}` : rel;
}

function resolveWorkspaceDirectoryId(dirId) {
  const id = String(dirId || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!id || id === 'workspace:primary') {
    return { id: '', abs: ROOT, rel: '', root: { id: '', name: path.basename(ROOT) || ROOT, path: ROOT }, isWorkspaceRoot: false };
  }
  for (const root of workspaceRoots) {
    if (id === root.id) return { id, abs: root.path, rel: '', root, isWorkspaceRoot: true };
    const prefix = `${root.id}/`;
    if (!id.startsWith(prefix)) continue;
    const rel = normalizeProjectRelPath(id.slice(prefix.length));
    if (!rel) return null;
    const abs = resolveInsideRoot(root.path, rel, { allowRoot: true });
    if (!abs) return null;
    return { id, abs, rel, root, isWorkspaceRoot: true };
  }
  const rel = normalizeProjectRelPath(id);
  if (!rel) return null;
  const abs = safeResolve(rel);
  if (!abs) return null;
  return { id: rel, abs, rel, root: { id: '', name: path.basename(ROOT) || ROOT, path: ROOT }, isWorkspaceRoot: false };
}

function recoverableTrashPath(resolved) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = path.basename(resolved.abs);
  const workspaceKey = resolved.root.id || 'primary';
  return path.join(STATE_DIR, 'trash', workspaceKey, `${stamp}-${crypto.randomUUID()}`, baseName);
}

function isWorkspaceRootResolved(resolved) {
  return resolved.abs === resolved.root.path;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (bridgeShuttingDown) {
      const error = new Error('bridge is shutting down');
      error.code = 'BRIDGE_SHUTTING_DOWN';
      reject(error);
      req.resume();
      return;
    }
    let body = '';
    let bytes = 0;
    let tooLarge = false;
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
      const error = new Error('request body too large');
      error.code = 'BODY_TOO_LARGE';
      reject(error);
      req.resume();
      return;
    }
    req.on('data', chunk => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        body = '';
        const error = new Error('request body too large');
        error.code = 'BODY_TOO_LARGE';
        reject(error);
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (bridgeShuttingDown) {
        const error = new Error('bridge is shutting down');
        error.code = 'BRIDGE_SHUTTING_DOWN';
        reject(error);
        return;
      }
      resolve(body);
    });
    req.on('error', reject);
  });
}

function respondInvalidRequestBody(res, error) {
  const shuttingDown = error?.code === 'BRIDGE_SHUTTING_DOWN';
  const tooLarge = error?.code === 'BODY_TOO_LARGE';
  if (tooLarge) res.shouldKeepAlive = false;
  res.writeHead(shuttingDown ? 503 : tooLarge ? 413 : 400, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    ...(tooLarge ? { Connection: 'close' } : {}),
  });
  res.end(shuttingDown
    ? JSON.stringify({ error: 'bridge is shutting down' })
    : tooLarge ? JSON.stringify({ error: 'request body too large' }) : '');
}

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

function cliPathEntries() {
  return uniquePathEntries([
    ...(process.env.PATH || '').split(path.delimiter),
    ...(process.env.DOCPILOT_EXTRA_PATH || '').split(path.delimiter),
    ...cliPathCandidates(),
  ]);
}

function cliEnv() {
  const env = {
    ...process.env,
    PATH: cliPathEntries().join(path.delimiter),
  };
  delete env.DOCPILOT_BRIDGE_TOKEN;
  delete env.DOCPILOT_STATE_DIR;
  delete env.DOCPILOT_ALLOW_UNAUTHENTICATED;
  return env;
}

function commandCandidates(cmd) {
  if (cmd.includes(path.sep) || path.isAbsolute(cmd)) return [cmd];
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .filter(Boolean)
    : [''];
  const names = extensions.map(ext => process.platform === 'win32' ? `${cmd}${ext}` : cmd);
  return cliPathEntries().flatMap(dir => names.map(name => path.join(dir, name)));
}

function commandExists(cmd) {
  for (const candidate of commandCandidates(cmd)) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return true;
    } catch {}
  }
  return false;
}

const USE_DIRENV = process.env.DOCPILOT_USE_DIRENV === '1' && commandExists('direnv');

function findCommand(cmd) {
  for (const candidate of commandCandidates(cmd)) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  return null;
}

function resolveSpawn(command, args) {
  if (USE_DIRENV) return { cmd: 'direnv', args: ['exec', ROOT, command, ...args] };
  return { cmd: findCommand(command) || command, args };
}

function codexExecArgs(command = 'codex') {
  return [
    command,
    'exec',
    '--json',
    '--ephemeral',
    '--cd', ROOT,
    '--sandbox', 'workspace-write',
    '--ask-for-approval', 'never',
    '-',
  ];
}

function claudePrintArgs(command = 'claude') {
  return [
    command,
    '-p',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
  ];
}

function fakeAgentPath() {
  return path.join(__dirname, 'scripts', 'fake-agent.js');
}

function shouldUseFakeAgent() {
  return process.env.DOCPILOT_FAKE_AGENT === '1' && fs.existsSync(fakeAgentPath());
}

function sessionSpawnSpec(session, prompt) {
  if (shouldUseFakeAgent()) {
    return {
      spawnArgs: [process.execPath, fakeAgentPath(), session.agent],
      stdinText: prompt,
      requiresCommand: process.execPath,
    };
  }
  const settings = readSettingsStore();
  const useCustomCommands = settings.agentCommandMode === 'custom';
  const claudeCommand = useCustomCommands ? settings.claudeCommand : 'claude';
  const codexCommand = useCustomCommands ? settings.codexCommand : 'codex';
  return {
    spawnArgs: session.agent === 'codex' ? codexExecArgs(codexCommand) : claudePrintArgs(claudeCommand),
    stdinText: prompt,
    requiresCommand: session.agent === 'codex' ? codexCommand : claudeCommand,
  };
}

function textFromClaudeContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map(part => part && part.type === 'text' ? String(part.text || '') : '')
    .join('');
}

const optionalModuleCache = new Map();
const optionalModulePathCache = new Map();
function loadOptionalModule(name) {
  if (optionalModuleCache.has(name)) return optionalModuleCache.get(name);
  let loaded = null;
  // The bridge itself runs from app.asar.unpacked. node-pty must still load its
  // JavaScript through app.asar so its built-in helper-path rewrite maps once
  // to app.asar.unpacked instead of producing app.asar.unpacked.unpacked.
  const packedRoot = __dirname.replace(/app\.asar\.unpacked(?=$|[\\/])/, 'app.asar');
  const candidates = packedRoot === __dirname
    ? [name]
    : [path.join(packedRoot, 'node_modules', name), name];
  for (const candidate of candidates) {
    try {
      const resolved = require.resolve(candidate);
      loaded = require(resolved);
      optionalModulePathCache.set(name, resolved);
      break;
    } catch {}
  }
  optionalModuleCache.set(name, loaded);
  return loaded;
}

function detectOptionalModule(name) {
  return Boolean(loadOptionalModule(name));
}

function prepareNodePtyRuntime() {
  try {
    const resolvedModule = optionalModulePathCache.get('node-pty') || require.resolve('node-pty');
    const packageRoot = path.resolve(path.dirname(resolvedModule), '..').replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked');
    const candidates = [
      path.join(packageRoot, 'build', 'Release', 'spawn-helper'),
      path.join(packageRoot, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper'),
    ];
    for (const helper of candidates) {
      if (!fs.existsSync(helper)) continue;
      fs.chmodSync(helper, 0o755);
    }
  } catch (error) {
    console.warn('node-pty runtime preparation failed:', error.message);
  }
}

function readAgentRuntime() {
  const settings = readSettingsStore();
  const useCustomCommands = settings.agentCommandMode === 'custom';
  const claudeCommand = useCustomCommands ? settings.claudeCommand : 'claude';
  const codexCommand = useCustomCommands ? settings.codexCommand : 'codex';
  const nodePtyAvailable = detectOptionalModule('node-pty');
  return {
    rendererTerminal: 'xterm',
    executionMode: nodePtyAvailable ? 'node-pty' : 'stream',
    ptyAvailable: nodePtyAvailable,
    ptyModule: 'node-pty',
    fallbackMode: 'child_process-sse',
    claudeCommand,
    codexCommand,
    commandMode: settings.agentCommandMode,
    cwd: ROOT,
  };
}

function terminalSpawnSpec() {
  if (shouldUseFakeAgent()) {
    return {
      shell: process.execPath,
      spawnArgs: [
        process.execPath,
        fakeAgentPath(),
        'shell',
        '--interactive',
        ...(TEST_TERMINAL_SEPARATE_GROUP ? ['--ignore-sigterm'] : []),
      ],
      requiresCommand: process.execPath,
      mode: 'fake-interactive',
    };
  }
  const shell = process.env.SHELL || '/bin/zsh';
  return {
    shell,
    spawnArgs: [shell, '-l'],
    requiresCommand: shell,
    usePty: readAgentRuntime().ptyAvailable,
    mode: readAgentRuntime().ptyAvailable ? 'node-pty' : 'child-process-interactive',
  };
}

function sendTerminalEvent(client, data) {
  try { client.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
}

function broadcastTerminalEvent(session, data) {
  for (const client of session.clients) {
    if (client.writableLength > 256 * 1024) {
      client.docpilotNeedsSnapshot = true;
      continue;
    }
    if (client.docpilotNeedsSnapshot) {
      client.docpilotNeedsSnapshot = false;
      sendTerminalEvent(client, { type: 'terminal.restore-needed', id: session.id, lastSeq: session.model.lastSeq });
      continue;
    }
    sendTerminalEvent(client, data);
  }
}

function summarizeTerminalSession(session) {
  return {
    id: session.id,
    title: session.title,
    shell: session.shell,
    status: session.status,
    mode: session.mode,
    createdAt: session.createdAt,
    cwd: session.cwd,
    lastSeq: session.model.lastSeq,
  };
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function signalAgentProcess(proc, signal) {
  const pid = Number(proc?.pid);
  if (proc?._docpilotOwnsProcessGroup && process.platform !== 'win32' && Number.isInteger(pid) && pid > 1) {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {}
  }
  try {
    proc?.kill(signal);
    return true;
  } catch {
    return false;
  }
}

function notifyAgentGroup(proc, type) {
  const id = String(proc?._docpilotGroupId || '');
  const pid = Number(proc?.pid);
  if (!proc?._docpilotOwnsProcessGroup || !id || !Number.isInteger(pid) || pid <= 1 || typeof process.send !== 'function') return;
  try { process.send({ type, id, pid }); } catch {}
}

function forceAgentProcess(proc) {
  if (!proc) return;
  if (proc._docpilotForceKillTimer) {
    clearTimeout(proc._docpilotForceKillTimer);
    proc._docpilotForceKillTimer = null;
  }
  // Always address the group once the leader exits: agent CLIs may have
  // started MCP/tool descendants that outlive the direct child process.
  signalAgentProcess(proc, 'SIGKILL');
  if (!proc._docpilotGroupStopped) {
    proc._docpilotGroupStopped = true;
    notifyAgentGroup(proc, 'agent-group-stopped');
  }
  stoppingAgentProcesses.delete(proc);
}

function scheduleAgentForceKill(proc) {
  if (!proc || proc._docpilotForceKillTimer) return;
  stoppingAgentProcesses.add(proc);
  proc._docpilotForceKillTimer = setTimeout(() => forceAgentProcess(proc), AGENT_FORCE_KILL_DELAY_MS);
  proc._docpilotForceKillTimer.unref?.();
}

function stopAgentProcess(proc) {
  if (!proc || proc._docpilotStopping) return;
  proc._docpilotStopping = true;
  signalAgentProcess(proc, 'SIGTERM');
  scheduleAgentForceKill(proc);
}

function finishAgentProcess(proc) {
  if (!proc) return;
  // The group leader can finish while a background tool keeps running.
  // A final group signal prevents that descendant from becoming an orphan.
  if (proc._docpilotOwnsProcessGroup) forceAgentProcess(proc);
  else {
    if (proc._docpilotForceKillTimer) clearTimeout(proc._docpilotForceKillTimer);
    proc._docpilotForceKillTimer = null;
    stoppingAgentProcesses.delete(proc);
  }
}

function signalTerminalSession(session, signal) {
  const pid = Number(session?.proc?.pid);
  if (session?.ownsProcessGroup && process.platform !== 'win32' && Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {}
  }
  try {
    session?.proc?.kill(signal);
    return true;
  } catch {
    return false;
  }
}

function notifyTerminalGroup(session, type) {
  const pid = Number(session?.proc?.pid);
  if (!session?.ownsProcessGroup || !Number.isInteger(pid) || pid <= 1 || typeof process.send !== 'function') return;
  try { process.send({ type, id: session.id, pid }); } catch {}
}

function forceTerminalSession(session) {
  if (!session) return;
  if (session.forceKillTimer) {
    clearTimeout(session.forceKillTimer);
    session.forceKillTimer = null;
  }
  signalTerminalSession(session, 'SIGKILL');
  notifyTerminalGroup(session, 'terminal-group-stopped');
  stoppingTerminalSessions.delete(session);
}

function scheduleTerminalForceKill(session) {
  if (!session || session.forceKillTimer) return;
  stoppingTerminalSessions.add(session);
  session.forceKillTimer = setTimeout(() => forceTerminalSession(session), TERMINAL_FORCE_KILL_DELAY_MS);
  session.forceKillTimer.unref?.();
}

function stopTerminalSession(id, reason = 'stopped') {
  const session = terminalSessions.get(id);
  if (!session) return null;
  session.status = 'closed';
  broadcastTerminalEvent(session, { type: 'terminal.exit', id, reason });
  for (const client of session.clients) {
    try { client.end(); } catch {}
  }
  session.clients.clear();
  session.model.dispose();
  session.stopping = true;
  signalTerminalSession(session, 'SIGTERM');
  scheduleTerminalForceKill(session);
  terminalSessions.delete(id);
  return session;
}

function defaultSettingsStore() {
  return {
    version: 1,
    autosave: false,
    theme: 'system',
    agentCommandMode: 'auto',
    claudeCommand: 'claude',
    codexCommand: 'codex',
    fileWatcherIgnore: '',
    recentWorkspaces: [],
  };
}

function normalizeSettingsInput(input = {}) {
  const previous = defaultSettingsStore();
  const theme = ['dark', 'light', 'system'].includes(input.theme) ? input.theme : previous.theme;
  const agentCommandMode = input.agentCommandMode === 'custom' ? 'custom' : 'auto';
  const claudeCommand = String(input.claudeCommand || previous.claudeCommand).trim().slice(0, 240) || previous.claudeCommand;
  const codexCommand = String(input.codexCommand || previous.codexCommand).trim().slice(0, 240) || previous.codexCommand;
  const fileWatcherIgnore = String(input.fileWatcherIgnore || '').slice(0, 2000);
  const recentWorkspaces = Array.isArray(input.recentWorkspaces)
    ? input.recentWorkspaces
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 12)
    : [];
  return {
    version: 1,
    autosave: input.autosave === true,
    theme,
    agentCommandMode,
    claudeCommand,
    codexCommand,
    fileWatcherIgnore,
    recentWorkspaces,
  };
}

function readSettingsStore() {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return normalizeSettingsInput({ ...defaultSettingsStore(), ...data });
  } catch {
    return defaultSettingsStore();
  }
}

function writeSettingsStore(store) {
  const next = normalizeSettingsInput(store);
  writeJsonAtomic(SETTINGS_FILE, next);
  return next;
}

function rememberWorkspaceInSettings(folderPath = ROOT) {
  const settings = readSettingsStore();
  const current = String(folderPath || '').trim();
  if (!current) return settings;
  settings.recentWorkspaces = [
    current,
    ...settings.recentWorkspaces.filter(item => item !== current),
  ].slice(0, 12);
  return writeSettingsStore(settings);
}

function readDiagnostics() {
  let sessionLogCount = 0;
  try {
    ensurePrivateDirectory(SESSION_LOGS_DIR);
    sessionLogCount = fs.readdirSync(SESSION_LOGS_DIR).filter(name => name.endsWith('.jsonl')).length;
  } catch {}
  return {
    root: ROOT,
    docpilotDir: STATE_DIR,
    settingsFile: SETTINGS_FILE,
    sessionsFile: SESSIONS_FILE,
    sessionLogsDir: SESSION_LOGS_DIR,
    sessionLogCount,
    bridgePid: process.pid,
    port: PORT,
  };
}

function readInstructionsStore() {
  try {
    const data = JSON.parse(fs.readFileSync(INSTRUCTIONS_FILE, 'utf8'));
    return {
      version: 1,
      instructions: Array.isArray(data.instructions) ? data.instructions : [],
      sets: Array.isArray(data.sets) ? data.sets : [],
      activeSetId: data.activeSetId || '',
    };
  } catch {
    return { version: 1, instructions: [], sets: [], activeSetId: '' };
  }
}

function writeInstructionsStore(store) {
  writeJsonAtomic(INSTRUCTIONS_FILE, store);
}

function parseInstructionSource(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const copiedContextMatch = text.match(/(?:^|\n)File:\s*([^\n]+)\nLines?:\s*(\d+)(?:-(\d+))?/i);
  if (copiedContextMatch) {
    return {
      file: copiedContextMatch[1].trim(),
      lineStart: Number(copiedContextMatch[2]),
      lineEnd: Number(copiedContextMatch[3] || copiedContextMatch[2]),
    };
  }

  const refMatch = text.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!refMatch) return null;
  const file = refMatch[1].trim();
  if (!file || /[\n\r]/.test(file)) return null;
  return {
    file,
    lineStart: refMatch[2] ? Number(refMatch[2]) : undefined,
    lineEnd: refMatch[3] ? Number(refMatch[3]) : refMatch[2] ? Number(refMatch[2]) : undefined,
  };
}

function readInstructionSourceBody(source) {
  if (!source?.file) return '';
  const relative = path.isAbsolute(source.file) ? path.relative(ROOT, source.file) : source.file;
  const absolute = resolveInsideRoot(ROOT, relative, { allowRoot: false });
  if (!absolute) return '';
  let content;
  try {
    if (!fs.statSync(absolute).isFile()) return '';
    content = fs.readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
  if (!source.lineStart || !source.lineEnd) return content.trim();

  const lines = content.split(/\r?\n/);
  const start = Math.max(1, source.lineStart);
  const end = Math.max(start, source.lineEnd);
  return lines.slice(start - 1, end).join('\n').trim();
}

function hydrateInstructionSources(store) {
  let changed = false;
  const instructions = (store.instructions || []).map(item => {
    const source = parseInstructionSource(item.sourceRef) || parseInstructionSource(item.body);
    if (!source) return item;

    const body = readInstructionSourceBody(source);
    if (!body || body.trim() === String(item.body || '').trim()) return item;
    changed = true;
    return { ...item, body, updatedAt: new Date().toISOString() };
  });

  return {
    store: { ...store, instructions },
    changed,
  };
}

function readHydratedInstructionsStore(options = {}) {
  const hydrated = hydrateInstructionSources(readInstructionsStore());
  if (options.persist && hydrated.changed) writeInstructionsStore(hydrated.store);
  return hydrated.store;
}

function readGlobalInstructionSetsStore() {
  try {
    const data = JSON.parse(fs.readFileSync(GLOBAL_INSTRUCTION_SETS_FILE, 'utf8'));
    return {
      version: 1,
      sets: Array.isArray(data.sets) ? data.sets : [],
      activeSetId: data.activeSetId || '',
    };
  } catch {
    return { version: 1, sets: [], activeSetId: '' };
  }
}

function writeGlobalInstructionSetsStore(store) {
  writeJsonAtomic(GLOBAL_INSTRUCTION_SETS_FILE, store);
}

function instructionStatePayload(project = readInstructionsStore(), global = readGlobalInstructionSetsStore()) {
  project = hydrateInstructionSources(project).store;
  return {
    instructions: project.instructions || [],
    projectSets: project.sets || [],
    sets: project.sets || [],
    globalSets: global.sets || [],
    activeSetId: project.activeSetId || '',
    globalActiveSetId: global.activeSetId || '',
  };
}

function normalizeInstructionSetInput(input, activeInstructions) {
  const now = new Date().toISOString();
  const scope = input.scope === 'global' ? 'global' : 'project';
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) return null;
  const active = Array.isArray(activeInstructions) ? activeInstructions.filter(i => i && i.id && i.body) : [];
  if (!active.length) return null;
  return {
    id: input.id || crypto.randomUUID(),
    scope,
    name,
    instructionIds: active.map(i => i.id),
    instructions: scope === 'global'
      ? active.map(i => ({
        id: i.globalSourceId || i.id,
        title: i.title || 'Untitled instruction',
        body: i.body || '',
        sourceType: i.sourceType || 'manual',
        sourceRef: i.sourceRef || '',
      }))
      : [],
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function normalizeInstructionInput(input) {
  const now = new Date().toISOString();
  const title = String(input.title || '').trim().slice(0, 120) || 'Untitled instruction';
  const body = String(input.body || '').trim();
  if (!body) return null;
  return {
    id: input.id || crypto.randomUUID(),
    title,
    body,
    active: input.active !== false,
    sourceType: input.sourceType || 'manual',
    sourceRef: input.sourceRef || '',
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function activeInstructionsText() {
  const active = readHydratedInstructionsStore({ persist: true }).instructions.filter(i => i.active && i.body);
  if (!active.length) return '';
  return active.map((item, idx) =>
    `[Instruction ${idx + 1}: ${item.title}]\n${item.body.trim()}`
  ).join('\n\n');
}

function activeInstructionsTextCompact(maxPerInstruction = 700) {
  const active = readHydratedInstructionsStore({ persist: true }).instructions.filter(i => i.active && i.body);
  if (!active.length) return '';
  return active.map((item, idx) => {
    const body = String(item.body || '').trim().replace(/\s+/g, ' ');
    const compact = body.length > maxPerInstruction ? `${body.slice(0, maxPerInstruction)}…` : body;
    return `[Instruction ${idx + 1}: ${item.title}]\n${compact}`;
  }).join('\n\n');
}

function instructionPromptBlock(options = {}) {
  const text = options.compact ? activeInstructionsTextCompact(options.maxPerInstruction) : activeInstructionsText();
  if (!text) return '';
  return `${options.compact ? 'ACTIVE DOCUMENT INSTRUCTIONS SUMMARY' : 'NON-NEGOTIABLE ACTIVE DOCUMENT INSTRUCTIONS'}

The following active DocPilot instructions outrank general style preferences and ordinary user wording. Treat them as binding constraints for this response and for any file content you produce.

\`\`\`
${text}
\`\`\`

Required behavior:
- Follow every active instruction above.
- Apply them to structure, tone, wording, formatting, and content decisions.
- If the user request conflicts with an active instruction, preserve the active instruction and make the closest valid edit.
- Do not dilute, ignore, reinterpret, or mention these instructions as optional guidance.

Silent final check:
- Before producing the final answer or final file content, check the draft against each active instruction.
- If any instruction is violated, revise the draft until it complies.
- Do not mention this validation unless the user explicitly asks.

`;
}

function readSessionsStore() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    return {
      version: 1,
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      messages: data.messages && typeof data.messages === 'object' ? data.messages : {},
      artifacts: data.artifacts && typeof data.artifacts === 'object' ? data.artifacts : {},
    };
  } catch {
    return { version: 1, sessions: [], messages: {}, artifacts: {} };
  }
}

function compactSessionSummary(previousSummary, messages, limit = 1800) {
  const existing = String(previousSummary || '').trim();
  const lines = (Array.isArray(messages) ? messages : []).map(message => {
    const text = String(message.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const role = message.role === 'assistant' ? 'Assistant' : 'User';
    return `- ${role}: ${text.slice(0, 260)}`;
  }).filter(Boolean);
  const next = [existing, lines.join('\n')].filter(Boolean).join('\n');
  if (next.length <= limit) return next;
  const tail = next.slice(next.length - limit);
  const boundary = tail.indexOf('\n- ');
  return boundary > 0 ? tail.slice(boundary + 1) : tail;
}

function refreshSessionSummary(session, messages, retainRecent = 6) {
  if (!session) return session;
  const all = Array.isArray(messages) ? messages : [];
  const cutoff = Math.max(0, all.length - retainRecent);
  const summarizedUntil = Number.isFinite(Number(session.summaryMessageCount))
    ? Number(session.summaryMessageCount)
    : 0;
  if (cutoff <= summarizedUntil) return session;
  const nextMessages = all.slice(summarizedUntil, cutoff);
  session.summary = compactSessionSummary(session.summary || '', nextMessages);
  session.summaryMessageCount = cutoff;
  session.summaryUpdatedAt = new Date().toISOString();
  return session;
}

function writeSessionsStore(store) {
  writeJsonAtomic(SESSIONS_FILE, store);
}

function sessionLogFile(sessionId) {
  const safeId = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return safeId ? path.join(SESSION_LOGS_DIR, `${safeId}.jsonl`) : null;
}

function appendSessionLog(sessionId, event) {
  const file = sessionLogFile(sessionId);
  if (!file) return;
  const entry = {
    ts: new Date().toISOString(),
    sessionId,
    ...event,
  };
  try {
    ensurePrivateDirectory(SESSION_LOGS_DIR);
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
  } catch {}
}

function readSessionLogs(sessionId, limit = 200) {
  const file = sessionLogFile(sessionId);
  if (!file) return [];
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit);
    return lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeSessionAgent(agent) {
  return agent === 'codex' ? 'codex' : 'claude';
}

function normalizeSessionScope(rawScope = {}) {
  const scope = rawScope && typeof rawScope === 'object' ? rawScope : {};
  return {
    root: ROOT,
    type: ['project', 'root', 'folder', 'file', 'edit'].includes(scope.type) ? scope.type : '',
    id: String(scope.id || '').slice(0, 500),
    currentFileId: String(scope.currentFileId || scope.fileId || '').slice(0, 500),
  };
}

function createSessionRecord({ agent, title, scope }) {
  const now = new Date().toISOString();
  const normalizedAgent = normalizeSessionAgent(agent);
  const session = {
    id: crypto.randomUUID(),
    agent: normalizedAgent,
    title: String(title || `${normalizedAgent === 'claude' ? 'Claude' : 'Codex'} session`).trim().slice(0, 100),
    status: 'idle',
    scope: normalizeSessionScope(scope),
    createdAt: now,
    updatedAt: now,
    lastTurnId: '',
    summary: '',
    summaryMessageCount: 0,
    summaryUpdatedAt: '',
  };
  const store = readSessionsStore();
  store.sessions.unshift(session);
  store.messages[session.id] = [];
  store.artifacts[session.id] = [];
  writeSessionsStore(store);
  appendSessionLog(session.id, { type: 'session.created', agent: session.agent, title: session.title, scope: session.scope });
  return session;
}

function summarizeSession(session) {
  return {
    id: session.id,
    agent: session.agent,
    title: session.title,
    status: session.status || 'idle',
    scope: session.scope || { root: ROOT },
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastTurnId: session.lastTurnId || '',
    summary: session.summary || '',
    summaryChars: String(session.summary || '').length,
    summaryMessageCount: Number(session.summaryMessageCount || 0),
    summaryUpdatedAt: session.summaryUpdatedAt || '',
  };
}

function summarizePromptPackageMetadata(metadata) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  const included = source.included && typeof source.included === 'object' ? source.included : {};
  const omitted = source.omitted && typeof source.omitted === 'object' ? source.omitted : {};
  const scope = source.scope && typeof source.scope === 'object' ? source.scope : {};
  return {
    version: source.version || 1,
    mode: String(source.mode || 'fast'),
    contextMode: String(source.contextMode || 'minimal'),
    turnType: String(source.turnType || 'chat'),
    agent: String(source.agent || ''),
    sessionId: String(source.sessionId || ''),
    scope: {
      type: String(scope.type || ''),
      id: String(scope.id || ''),
      currentFileId: String(scope.currentFileId || ''),
    },
    targetFileId: String(source.targetFileId || ''),
    inputChars: Number(source.inputChars || 0),
    totalPromptChars: Number(source.totalPromptChars || 0),
    summaryChars: Number(source.summaryChars || 0),
    included: {
      transcriptMessages: Number(included.transcriptMessages || 0),
      attachments: Number(included.attachments || 0),
      summaryChars: Number(included.summaryChars || 0),
    },
    omitted: {
      transcriptMessages: Number(omitted.transcriptMessages || 0),
      attachments: Number(omitted.attachments || 0),
    },
  };
}

function extractSessionArtifacts(text, fallbackFileId = '') {
  const artifacts = [];
  const re = /<docpilot-artifact\s+kind="([^"]+)"\s+file="([^"]*)"\s*>([\s\S]*?)<\/docpilot-artifact>/g;
  let match;
  while ((match = re.exec(text))) {
    const kind = match[1] || 'patch';
    const fileId = match[2] || fallbackFileId;
    const proposedContent = match[3].replace(/^\n|\n$/g, '');
    if (!fileId || !proposedContent) continue;
    artifacts.push({
      id: crypto.randomUUID(),
      kind,
      fileId,
      proposedContent,
      createdAt: new Date().toISOString(),
    });
  }
  return artifacts;
}

function parseArtifactAttrs(attrText) {
  const attrs = {};
  const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match;
  while ((match = re.exec(attrText || ''))) attrs[match[1]] = match[2];
  return attrs;
}

function extractDocpilotArtifacts(text) {
  const artifacts = [];
  const re = /<docpilot-artifact\b([^>]*)>([\s\S]*?)<\/docpilot-artifact>/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    const attrs = parseArtifactAttrs(match[1]);
    const content = match[2].replace(/^\n|\n$/g, '');
    if (!attrs.kind || !content) continue;
    artifacts.push({
      id: crypto.randomUUID(),
      kind: attrs.kind,
      fileId: attrs.file || '',
      content,
      createdAt: new Date().toISOString(),
    });
  }
  return artifacts;
}

function normalizeProjectRelPath(inputPath) {
  const value = String(inputPath || '').trim().replace(/\\/g, '/');
  if (!value || value === '.' || value === '/') return null;
  if (path.isAbsolute(value)) return null;
  const normalized = path.posix.normalize(value).replace(/^(\.\/)+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return null;
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return null;
  if (parts.some(part => HIDDEN_DIRS.has(part))) return null;
  return parts.join('/');
}

function inspectFileOperation(input) {
  const op = input && typeof input === 'object' ? String(input.op || '').trim() : '';
  const relPath = normalizeProjectRelPath(input && input.path);
  const reason = String(input?.reason || '').trim().slice(0, 500);
  if (op !== 'delete') return { ok: false, error: `unsupported op: ${op || 'missing'}` };
  if (!relPath) return { ok: false, error: 'invalid path' };
  const abs = safeResolve(relPath);
  if (!abs || abs === ROOT) return { ok: false, error: 'path outside project root' };
  let exists = false;
  let type = 'missing';
  try {
    const stat = fs.statSync(abs);
    exists = true;
    type = stat.isDirectory() ? 'directory' : 'file';
  } catch {}
  return { ok: true, op, path: relPath, reason, exists, type };
}

function parseFileOpsArtifact(artifact) {
  if (!artifact || artifact.kind !== 'file-ops') return null;
  let parsed;
  try {
    parsed = JSON.parse(artifact.content);
  } catch {
    return {
      ...artifact,
      summary: '',
      operations: [],
      errors: ['file-ops artifact is not valid JSON'],
    };
  }
  const rawOps = Array.isArray(parsed.operations) ? parsed.operations : [];
  const operations = [];
  const errors = [];
  for (const raw of rawOps.slice(0, 200)) {
    const inspected = inspectFileOperation(raw);
    if (inspected.ok) operations.push(inspected);
    else errors.push(inspected.error);
  }
  return {
    ...artifact,
    summary: String(parsed.summary || '').trim().slice(0, 1000),
    operations,
    errors,
  };
}

function extractFileOpsArtifacts(text) {
  return extractDocpilotArtifacts(text).filter(item => item.kind === 'file-ops').map(parseFileOpsArtifact).filter(Boolean);
}

async function applyFileOperations(operations) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trashRoot = path.join(STATE_DIR, 'trash', 'primary', `${stamp}-${crypto.randomUUID()}`);
  const applied = [];
  const skipped = [];
  for (const raw of Array.isArray(operations) ? operations : []) {
    const inspected = inspectFileOperation(raw);
    if (!inspected.ok) {
      skipped.push({ op: raw?.op || '', path: raw?.path || '', reason: inspected.error });
      continue;
    }
    if (!inspected.exists) {
      skipped.push({ ...inspected, reason: 'target does not exist' });
      continue;
    }
    const abs = safeResolve(inspected.path);
    const trashPath = path.join(trashRoot, inspected.path);
    try {
      await movePathToRecoverableTrashAsync(abs, trashPath);
      applied.push({ ...inspected, trashPath: path.relative(STATE_DIR, trashPath).replace(/\\/g, '/') });
    } catch (err) {
      skipped.push({ ...inspected, reason: err.message });
    }
  }
  return { applied, skipped, trashRoot: path.relative(STATE_DIR, trashRoot).replace(/\\/g, '/') };
}

function settingsIgnorePatterns() {
  return String(readSettingsStore().fileWatcherIgnore || '')
    .split(/[\n,]/)
    .map(item => item.trim().replace(/^\/+/, '').replace(/\\/g, '/'))
    .filter(Boolean)
    .slice(0, 80);
}

function matchesIgnorePattern(relPath, pattern) {
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const pat = String(pattern || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || !pat) return false;
  if (pat.endsWith('/**')) {
    const base = pat.slice(0, -3).replace(/\/+$/, '');
    return rel === base || rel.startsWith(`${base}/`);
  }
  if (pat.startsWith('*.')) return rel.split('/').pop()?.endsWith(pat.slice(1)) || false;
  return rel === pat || rel.startsWith(`${pat}/`);
}

function shouldSkipProjectPath(relPath, ignorePatterns = []) {
  const rel = String(relPath || '');
  if (rel.split(/[\\/]/).filter(Boolean).some(part => HIDDEN_DIRS.has(part) || part.startsWith('.'))) return true;
  return ignorePatterns.some(pattern => matchesIgnorePattern(rel, pattern));
}

async function collectProjectFiles() {
  const files = [];
  const folders = [];
  const signatureParts = [];
  const ignorePatterns = settingsIgnorePatterns();
  async function walk(dir, rel, prefix = '') {
    let hasVisibleDoc = false;
    let entries;
    try { entries = await fs.promises.readdir(dir); } catch { return false; }
    entries.sort();
    for (const name of entries) {
      if (HIDDEN_DIRS.has(name) || name.startsWith('.')) continue;
      const abs = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (shouldSkipProjectPath(relPath, ignorePatterns)) continue;
      let stat;
      try { stat = await fs.promises.lstat(abs); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        const id = prefix ? `${prefix}/${relPath}` : relPath;
        const childHasVisibleDoc = await walk(abs, relPath, prefix);
        if (childHasVisibleDoc) {
          folders.push(id);
          signatureParts.push(`${id}/:${stat.mtimeMs}:${stat.ctimeMs}:dir`);
          hasVisibleDoc = true;
        }
      } else if (DOC_EXTENSIONS.has(path.extname(name).toLowerCase())) {
        const id = prefix ? `${prefix}/${relPath}` : relPath;
        files.push(id);
        signatureParts.push(`${id}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`);
        hasVisibleDoc = true;
      }
    }
    return hasVisibleDoc;
  }
  await walk(ROOT, '');
  for (const root of workspaceRoots) {
    await walk(root.path, '', root.id);
  }
  return { files, folders, roots: publicWorkspaceRoots(), signature: signatureParts.join('\n') };
}

async function collectWorkspaceSnapshot() {
  const { files, roots } = await collectProjectFiles();
  const snapshotFiles = [];
  for (const id of files) {
    const resolved = resolveWorkspaceFileId(id);
    if (!resolved) continue;
    try {
      const content = await fs.promises.readFile(resolved.abs, 'utf8');
      snapshotFiles.push({
        id,
        hash: crypto.createHash('sha1').update(content).digest('hex'),
        content,
      });
    } catch {}
  }
  return { files: snapshotFiles, roots, createdAt: new Date().toISOString() };
}

const watchClients = new Set();
const projectWatchers = new Map();
let projectWatchPoller = null;
let projectWatchTimer = null;
let projectWatchSignature = null;
let projectWatchScanRunning = false;

function sendWatchEvent(client, data) {
  try { client.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
}

function broadcastProjectChange(reason = 'change') {
  if (!watchClients.size) return;
  const payload = { type: 'files.changed', reason, ts: Date.now() };
  for (const client of watchClients) sendWatchEvent(client, payload);
}

function scheduleProjectChange(reason = 'change') {
  clearTimeout(projectWatchTimer);
  projectWatchTimer = setTimeout(() => broadcastProjectChange(reason), 180);
}

async function updateProjectWatchSignature(reason = 'poll') {
  if (projectWatchScanRunning) return;
  projectWatchScanRunning = true;
  let snapshot;
  try { snapshot = await collectProjectFiles(); }
  catch { return; }
  finally { projectWatchScanRunning = false; }
  if (projectWatchSignature === null) {
    projectWatchSignature = snapshot.signature;
    return;
  }
  if (snapshot.signature !== projectWatchSignature) {
    projectWatchSignature = snapshot.signature;
    scheduleProjectChange(reason);
  }
}

function startProjectWatchPoller() {
  if (projectWatchPoller) return;
  projectWatchPoller = setInterval(() => updateProjectWatchSignature('poll'), 2000);
  projectWatchPoller.unref?.();
}

function watchedProjectRoots() {
  return new Map([
    ['primary', ROOT],
    ...workspaceRoots.map(root => [root.id, root.path]),
  ]);
}

function syncProjectWatchers() {
  const wanted = watchedProjectRoots();
  for (const [id, watcher] of projectWatchers) {
    if (wanted.get(id)) continue;
    try { watcher.close(); } catch {}
    projectWatchers.delete(id);
  }

  let needsPoller = false;
  for (const [id, rootPath] of wanted) {
    if (projectWatchers.has(id)) continue;
    let watcher;
    try {
      watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
        const rel = filename ? filename.toString() : '';
        if (rel && shouldSkipProjectPath(rel, settingsIgnorePatterns())) return;
        scheduleProjectChange(eventType || 'change');
      });
      projectWatchers.set(id, watcher);
      watcher.on('error', () => {
        try { watcher.close(); } catch {}
        if (projectWatchers.get(id) === watcher) projectWatchers.delete(id);
        startProjectWatchPoller();
      });
    } catch {
      needsPoller = true;
    }
  }
  if (needsPoller) {
    startProjectWatchPoller();
  } else if (projectWatchPoller && projectWatchers.size === wanted.size) {
    clearInterval(projectWatchPoller);
    projectWatchPoller = null;
  }
}

function startProjectWatch() {
  if (projectWatchers.size || projectWatchPoller) {
    syncProjectWatchers();
    return;
  }
  collectProjectFiles().then(r => { projectWatchSignature = r.signature; }).catch(() => { projectWatchSignature = null; });
  syncProjectWatchers();
  if (!projectWatchers.size) startProjectWatchPoller();
}

function refreshProjectWatchRoots() {
  if (!watchClients.size) return;
  syncProjectWatchers();
  void updateProjectWatchSignature('workspace-roots');
}

function stopProjectWatchIfIdle() {
  if (watchClients.size) return;
  stopProjectWatch();
}

function stopProjectWatch() {
  clearTimeout(projectWatchTimer);
  projectWatchTimer = null;
  for (const watcher of projectWatchers.values()) {
    try { watcher.close(); } catch {}
  }
  projectWatchers.clear();
  if (projectWatchPoller) {
    clearInterval(projectWatchPoller);
    projectWatchPoller = null;
  }
  projectWatchSignature = null;
  projectWatchScanRunning = false;
}

function runTextCommand(command, args, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const resolved = resolveSpawn(command, args);
    const proc = spawn(resolved.cmd, resolved.args, {
      cwd: ROOT,
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error('timeout'));
    }, timeoutMs);
    proc.stdout.on('data', chunk => stdout += chunk.toString());
    proc.stderr.on('data', chunk => stderr += chunk.toString());
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `exit code ${code}`));
    });
  });
}

function runCommandWithInput(command, args, input, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const resolved = resolveSpawn(command, args);
    const proc = spawn(resolved.cmd, resolved.args, {
      cwd: ROOT,
      env: cliEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error('timeout'));
    }, timeoutMs);
    proc.stdout.on('data', chunk => stdout += chunk.toString());
    proc.stderr.on('data', chunk => stderr += chunk.toString());
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0 || stdout || stderr) resolve((stdout + stderr).trim());
      else reject(new Error(`exit code ${code}`));
    });
    proc.stdin.end(input || '');
  });
}

function runGitStatusPorcelain() {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: ROOT,
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error('timeout'));
    }, 5000);
    proc.stdout.on('data', chunk => stdout += chunk.toString());
    proc.stderr.on('data', chunk => stderr += chunk.toString());
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.replace(/\r/g, ''));
      else reject(new Error(stderr.trim() || `exit code ${code}`));
    });
  });
}

function runGitShowFile(relPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['show', `HEAD:${relPath}`], {
      cwd: ROOT,
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error('timeout'));
    }, 5000);
    proc.stdout.on('data', chunk => stdout += chunk.toString());
    proc.stderr.on('data', chunk => stderr += chunk.toString());
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.replace(/\r/g, ''));
      else reject(new Error(stderr.trim() || `exit code ${code}`));
    });
  });
}

function cleanTerminalOutput(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;?<>]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[=>]./g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/(^|\n)\s*\d{1,3}\s{2,}/g, '$1')
    .replace(/\r/g, '\n');
}

function parseClaudeUsage(text) {
  const clean = cleanTerminalOutput(text);
  const five = clean.match(/Current session:\s*([^\n]+)/i);
  const week = clean.match(/Current week(?:\s*\([^)]*\))?:\s*([^\n]+)/i);
  return {
    fiveHour: five?.[1]?.trim() || null,
    weekly: week?.[1]?.trim() || null,
  };
}

function parseCodexStatusUsage(text) {
  const compact = cleanTerminalOutput(text).replace(/\s+/g, '');
  const tableFive = compact.match(/5hlimit:\[[^\]]*\](.*?)(?=Weeklylimit:|Credits:|GPT-[^:]*limit:|│|╰|$)/i);
  const tableWeekly = compact.match(/Weeklylimit:\[[^\]]*\](.*?)(?=Credits:|GPT-[^:]*limit:|5hlimit:|│|╰|$)/i);
  const inlineFive = compact.match(/5h(\d+)%left/i);
  const inlineWeekly = compact.match(/weekly(\d+)%left/i);
  const resets = compact.match(/Youhave(\d+)usagelimitresetsavailable/i);
  const formatLimit = value => value
    ? value
      .replace(/(\d+)%left/i, '$1% left')
      .replace(/\(resets([^)]*)\)/i, ' (resets $1)')
      .replace(/(\d{1,2}:\d{2})on/i, '$1 on')
      .replace(/on(\d{1,2})([A-Za-z]{3})/i, 'on $1 $2')
      .trim()
    : null;
  return {
    fiveHour: formatLimit(tableFive?.[1])
      || (inlineFive ? `${inlineFive[1]}% left` : null),
    weekly: formatLimit(tableWeekly?.[1])
      || (inlineWeekly ? `${inlineWeekly[1]}% left` : null),
    resets: resets ? `${resets[1]} resets available` : null,
  };
}

async function readClaudeLimits() {
  try {
    return parseClaudeUsage(await runTextCommand('claude', ['-p', '/usage'], 12000));
  } catch {
    return { fiveHour: null, weekly: null };
  }
}

async function readCodexLimits() {
  const script = `set timeout 25
set env(TERM) xterm-256color
set env(COLUMNS) 140
set env(LINES) 50
spawn codex --no-alt-screen
stty rows 50 columns 140 < $spawn_out(slave,name)
after 2500
send "/status\\r"
expect {
  -re "5h limit:|5h.*left|Limits:|refresh requested" {}
  timeout {}
}
after 1000
send "\\003"
after 500
close
wait
`;
  try {
    const raw = await runCommandWithInput('expect', [], script, 30000);
    const parsed = parseCodexStatusUsage(raw);
    return {
      fiveHour: parsed.fiveHour || null,
      weekly: parsed.weekly || null,
      resets: parsed.resets || null,
    };
  } catch {
    return { fiveHour: null, weekly: null, resets: null };
  }
}

function fallbackInstruction(text) {
  const cleaned = String(text || '').trim();
  const firstLine = cleaned.split(/\r?\n/).find(Boolean) || 'Writing instruction';
  return {
    title: firstLine.replace(/^[-#*\s]+/, '').slice(0, 80) || 'Writing instruction',
    body: cleaned,
  };
}

rememberWorkspaceInSettings(ROOT);

const serverConnections = new Set();
async function handleBridgeRequest(req, res) {
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); }
  catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'invalid request URL' }));
    return;
  }
  const trustedTransport = isAllowedLoopbackHost(req.headers.host, PORT)
    && isAllowedRendererOrigin(req.headers.origin);
  if (!trustedTransport) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'untrusted bridge request' }));
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (!isAuthorizedBridgeRequest(req, url, {
    port: PORT,
    token: BRIDGE_TOKEN,
    allowUnauthenticated: ALLOW_UNAUTHENTICATED,
  })) {
    res.writeHead(403, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'bridge authorization required' }));
    return;
  }
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    req.resume();
    res.shouldKeepAlive = false;
    res.writeHead(413, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
    res.end(JSON.stringify({ error: 'request body too large' }));
    return;
  }

  // GET /ping
  if (req.method === 'GET' && url.pathname === '/ping') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, root: ROOT, pid: process.pid }));
    return;
  }

  // GET / — API status. The packaged editor is the Electron React renderer.
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'DocPilot bridge', renderer: 'electron-react', root: ROOT }));
    return;
  }

  // GET /status — claude/codex 설치 여부 반환
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    try {
      const rel = decodeURIComponent(url.pathname.slice('/assets/'.length));
      const abs = path.resolve(ASSETS_DIR, rel);
      if (!abs.startsWith(ASSETS_DIR + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
      }
      const ext = path.extname(abs).toLowerCase();
      const type = ASSET_TYPES.get(ext);
      if (!type || !fs.statSync(abs).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(abs).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    const [claude, codex] = await Promise.all([commandExists('claude'), commandExists('codex')]);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ claude, codex }));
    return;
  }

  // GET /watch — project file change event stream
  if (req.method === 'GET' && url.pathname === '/watch') {
    if (watchClients.size >= 8) {
      res.writeHead(429, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'too many watch clients' }));
      return;
    }
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    watchClients.add(res);
    startProjectWatch();
    sendWatchEvent(res, { type: 'watch.ready', ts: Date.now() });
    const keepalive = setInterval(() => sendWatchEvent(res, { type: 'watch.ping', ts: Date.now() }), 25000);
    req.on('close', () => {
      clearInterval(keepalive);
      watchClients.delete(res);
      stopProjectWatchIfIdle();
    });
    return;
  }

  // GET /files — markdown 파일 트리 반환
  if (req.method === 'GET' && url.pathname === '/files') {
    try {
      const { files, folders, roots } = await collectProjectFiles();
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files, folders, roots }));
    } catch (err) {
      res.writeHead(500, CORS); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /workspace-roots — attach another folder to the current workspace session
  if (req.method === 'POST' && url.pathname === '/workspace-roots') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const root = addWorkspaceRoot(payload.path || payload.folderPath);
    if (!root) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'invalid folder path' })); return; }
    refreshProjectWatchRoots();
    const { files, folders, roots } = await collectProjectFiles();
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, root, roots, files, folders }));
    scheduleProjectChange('workspace-root-added');
    return;
  }

  // DELETE /workspace-roots — detach a folder from the current workspace session
  if (req.method === 'DELETE' && url.pathname === '/workspace-roots') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const id = String(payload.id || '').trim();
    if (!id || !removeWorkspaceRoot(id)) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'workspace root not found' })); return; }
    refreshProjectWatchRoots();
    const { files, folders, roots } = await collectProjectFiles();
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, roots, files, folders }));
    scheduleProjectChange('workspace-root-removed');
    return;
  }

  // GET /file-status — git porcelain status for visible file tree
  if (req.method === 'GET' && url.pathname === '/file-status') {
    const statuses = {};
    try {
      const out = await runGitStatusPorcelain();
      out.split('\n').forEach(line => {
        if (!line.trim()) return;
        const m = line.match(/^(.{2})\s+(.+)$/);
        if (!m) return;
        const code = m[1];
        let file = m[2].trim();
        if (file.includes(' -> ')) file = file.split(' -> ').pop().trim();
        file = file.replace(/^"|"$/g, '');
        if (!file) return;
        if (code.includes('?') || code.includes('A')) statuses[file] = 'new';
        else if (code.trim()) statuses[file] = 'modified';
      });
    } catch {}
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ statuses }));
    return;
  }

  // GET /workspace-snapshot — visible text file contents for diff review baselines
  if (req.method === 'GET' && url.pathname === '/workspace-snapshot') {
    try {
      const snapshot = await collectWorkspaceSnapshot();
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot));
    } catch (err) {
      console.error('file-delete failed:', err);
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/settings') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ settings: readSettingsStore() }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/diagnostics') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ diagnostics: readDiagnostics() }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/agent-runtime') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ runtime: readAgentRuntime() }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/terminal-sessions') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions: Array.from(terminalSessions.values()).map(summarizeTerminalSession) }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/terminal-sessions') {
    if (terminalSessions.size >= 8) {
      res.writeHead(429, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'too many terminal sessions' }));
      return;
    }
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const spec = terminalSpawnSpec();
    const hasShell = fs.existsSync(spec.requiresCommand) || await commandExists(spec.requiresCommand);
    if (bridgeShuttingDown) {
      respondInvalidRequestBody(res, { code: 'BRIDGE_SHUTTING_DOWN' });
      return;
    }
    if (!hasShell) {
      res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `기본 셸을 찾을 수 없습니다: ${spec.requiresCommand}` }));
      return;
    }
    const cwd = typeof payload.cwd === 'string' && payload.cwd.trim()
      ? resolveInsideRoot(ROOT, payload.cwd, { allowRoot: true }) || ROOT
      : ROOT;
    const cols = boundedInteger(payload.cols, 100, 20, 240);
    const rows = boundedInteger(payload.rows, 30, 5, 80);
    const pty = spec.usePty ? loadOptionalModule('node-pty') : null;
    const fallbackOwnsProcessGroup = !pty && (process.platform !== 'win32' || TEST_TERMINAL_SEPARATE_GROUP);
    const resolved = pty ? { cmd: spec.spawnArgs[0], args: spec.spawnArgs.slice(1) } : resolveSpawn(spec.spawnArgs[0], spec.spawnArgs.slice(1));
    let proc;
    try {
      if (pty) prepareNodePtyRuntime();
      proc = pty
        ? pty.spawn(resolved.cmd, resolved.args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: cliEnv(),
        })
        : spawn(resolved.cmd, resolved.args, {
          cwd,
          env: cliEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          // POSIX detached children become process-group leaders, allowing a
          // terminal close to terminate the shell and every command it spawned.
          detached: fallbackOwnsProcessGroup,
        });
    } catch (error) {
      res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `터미널을 시작하지 못했습니다: ${error.message}` }));
      return;
    }
    const session = {
      id: crypto.randomUUID(),
      title: String(payload.title || `Terminal ${terminalSessions.size + 1}`).slice(0, 120),
      shell: spec.shell,
      status: 'running',
      mode: pty ? 'node-pty' : spec.mode,
      cwd,
      proc,
      clients: new Set(),
      acknowledgements: new Map(),
      model: new TerminalSessionModel({
        maxBytes: 2 * 1024 * 1024,
        cols,
        rows,
      }),
      createdAt: new Date().toISOString(),
      isPty: Boolean(pty),
      ownsProcessGroup: Boolean(pty || fallbackOwnsProcessGroup),
      write: data => {
        if (pty) proc.write(data);
        else proc.stdin.write(data);
      },
      resize: (cols, rows) => {
        if (pty && typeof proc.resize === 'function') proc.resize(cols, rows);
        session.model.resize(cols, rows);
      },
      kill: () => {
        if (pty) proc.kill();
        else proc.kill();
      },
    };
    terminalSessions.set(session.id, session);
    notifyTerminalGroup(session, 'terminal-group-started');
    if (pty) {
      proc.onData(data => {
        const frame = session.model.append(data);
        broadcastTerminalEvent(session, { type: 'terminal.frame', id: session.id, ...frame });
      });
      proc.onExit(event => {
        session.status = 'closed';
        broadcastTerminalEvent(session, { type: 'terminal.exit', id: session.id, code: event.exitCode, signal: event.signal });
        session.model.dispose();
        terminalSessions.delete(session.id);
        if (!session.stopping && session.ownsProcessGroup) forceTerminalSession(session);
      });
    } else {
      const onData = chunk => {
        const frame = session.model.append(chunk.toString());
        broadcastTerminalEvent(session, { type: 'terminal.frame', id: session.id, ...frame });
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('close', code => {
        session.status = 'closed';
        broadcastTerminalEvent(session, { type: 'terminal.exit', id: session.id, code });
        session.model.dispose();
        terminalSessions.delete(session.id);
        if (!session.stopping && session.ownsProcessGroup) forceTerminalSession(session);
      });
    }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ session: summarizeTerminalSession(session), runtime: readAgentRuntime() }));
    return;
  }

  const terminalStreamMatch = url.pathname.match(/^\/terminal-sessions\/([^/]+)\/stream$/);
  if (req.method === 'GET' && terminalStreamMatch) {
    const id = decodeURIComponent(terminalStreamMatch[1]);
    const session = terminalSessions.get(id);
    if (!session) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'terminal session not found' })); return; }
    if (session.clients.size >= 4) {
      res.writeHead(429, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'too many terminal clients' }));
      return;
    }
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    session.clients.add(res);
    sendTerminalEvent(res, { type: 'terminal.ready', session: summarizeTerminalSession(session), runtime: readAgentRuntime() });
    const fromSeq = Math.max(0, Number(url.searchParams.get('fromSeq') || 0));
    const replay = session.model.replayAfter(fromSeq);
    if (replay.needsSnapshot || fromSeq === 0) {
      sendTerminalEvent(res, { type: 'terminal.snapshot', id: session.id, snapshot: await session.model.screenSnapshot() });
    } else {
      for (const frame of replay.frames) sendTerminalEvent(res, { type: 'terminal.frame', id: session.id, ...frame });
    }
    req.on('close', () => {
      session.clients.delete(res);
    });
    return;
  }

  const terminalSnapshotMatch = url.pathname.match(/^\/terminal-sessions\/([^/]+)\/snapshot$/);
  if (req.method === 'GET' && terminalSnapshotMatch) {
    const id = decodeURIComponent(terminalSnapshotMatch[1]);
    const session = terminalSessions.get(id);
    if (!session) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'terminal session not found' })); return; }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ snapshot: await session.model.screenSnapshot(), session: summarizeTerminalSession(session) }));
    return;
  }

  const terminalAckMatch = url.pathname.match(/^\/terminal-sessions\/([^/]+)\/ack$/);
  if (req.method === 'POST' && terminalAckMatch) {
    const id = decodeURIComponent(terminalAckMatch[1]);
    const session = terminalSessions.get(id);
    if (!session) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'terminal session not found' })); return; }
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const viewId = String(payload.viewId || 'default');
    const seq = Math.max(0, Math.min(session.model.lastSeq, Number(payload.seq || 0)));
    session.acknowledgements.set(viewId, seq);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, seq }));
    return;
  }

  const terminalInputMatch = url.pathname.match(/^\/terminal-sessions\/([^/]+)\/input$/);
  if (req.method === 'POST' && terminalInputMatch) {
    const id = decodeURIComponent(terminalInputMatch[1]);
    const session = terminalSessions.get(id);
    if (!session) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'terminal session not found' })); return; }
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const data = String(payload.data || '');
    if (data) session.write(data);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const terminalResizeMatch = url.pathname.match(/^\/terminal-sessions\/([^/]+)\/resize$/);
  if (req.method === 'POST' && terminalResizeMatch) {
    const id = decodeURIComponent(terminalResizeMatch[1]);
    const session = terminalSessions.get(id);
    if (!session) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'terminal session not found' })); return; }
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const cols = boundedInteger(payload.cols, 100, 20, 240);
    const rows = boundedInteger(payload.rows, 30, 5, 80);
    session.resize(cols, rows);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, cols, rows }));
    return;
  }

  const terminalDeleteMatch = url.pathname.match(/^\/terminal-sessions\/([^/]+)$/);
  if (req.method === 'DELETE' && terminalDeleteMatch) {
    const id = decodeURIComponent(terminalDeleteMatch[1]);
    const stopped = stopTerminalSession(id, 'deleted');
    if (!stopped) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'terminal session not found' })); return; }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, session: summarizeTerminalSession(stopped) }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/adoc-convert') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const source = typeof payload.source === 'string' ? payload.source : '';
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (Buffer.byteLength(source, 'utf8') > 2 * 1024 * 1024) {
      res.writeHead(413, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AsciiDoc source is too large to preview' }));
      return;
    }
    if (asciidocWorkerPending.size >= 4) {
      res.writeHead(429, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'too many AsciiDoc conversions are pending' }));
      return;
    }
    const cacheKey = `${id}:${crypto.createHash('sha1').update(source).digest('hex')}`;
    let html = adocConvertCache.get(cacheKey);
    if (html === undefined) {
      try {
        html = rewriteAdocImageSrc(await convertAsciidocInWorker(source), id);
      } catch (err) {
        res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        return;
      }
      adocConvertCache.set(cacheKey, html);
      if (adocConvertCache.size > ADOC_CONVERT_CACHE_LIMIT) {
        adocConvertCache.delete(adocConvertCache.keys().next().value);
      }
    }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ html }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/workspace-asset') {
    const resolved = resolveWorkspaceFileId(url.searchParams.get('id') || '');
    if (!resolved) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    const ext = path.extname(resolved.abs).toLowerCase();
    const type = ASSET_TYPES.get(ext);
    if (!type) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    try {
      if (!fs.statSync(resolved.abs).isFile()) throw new Error('not a file');
      res.writeHead(200, { ...CORS, 'Content-Type': type, 'Cache-Control': 'no-cache' });
      fs.createReadStream(resolved.abs).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/settings') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const settings = writeSettingsStore(payload.settings && typeof payload.settings === 'object' ? payload.settings : payload);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, settings }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/sessions') {
    const store = readSessionsStore();
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions: store.sessions.map(summarizeSession) }));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/sessions') {
    writeSessionsStore({ version: 1, sessions: [], messages: {}, artifacts: {} });
    try { fs.rmSync(SESSION_LOGS_DIR, { recursive: true, force: true }); } catch {}
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: [] }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/sessions') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const session = createSessionRecord({
      agent: payload.agent,
      title: payload.title,
      scope: payload.scope,
    });
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ session: summarizeSession(session) }));
    return;
  }

  const sessionDetailMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
  const sessionLogsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/logs$/);
  if (req.method === 'GET' && sessionLogsMatch) {
    const id = decodeURIComponent(sessionLogsMatch[1]);
    const store = readSessionsStore();
    const session = store.sessions.find(item => item.id === id);
    if (!session) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'session not found' })); return; }
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') || 200)));
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ session: summarizeSession(session), logs: readSessionLogs(id, limit) }));
    return;
  }

  if (req.method === 'DELETE' && sessionDetailMatch) {
    const id = decodeURIComponent(sessionDetailMatch[1]);
    const store = readSessionsStore();
    const before = store.sessions.length;
    store.sessions = store.sessions.filter(item => item.id !== id);
    delete store.messages[id];
    delete store.artifacts[id];
    if (store.sessions.length === before) {
      res.writeHead(404, CORS);
      res.end(JSON.stringify({ error: 'session not found' }));
      return;
    }
    writeSessionsStore(store);
    appendSessionLog(id, { type: 'session.deleted' });
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: store.sessions.map(summarizeSession) }));
    return;
  }

  if (req.method === 'GET' && sessionDetailMatch) {
    const id = decodeURIComponent(sessionDetailMatch[1]);
    const store = readSessionsStore();
    const session = store.sessions.find(item => item.id === id);
    if (!session) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'session not found' })); return; }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      session: summarizeSession(session),
      messages: store.messages[id] || [],
      artifacts: store.artifacts[id] || [],
    }));
    return;
  }

  const sessionPromoteMatch = url.pathname.match(/^\/sessions\/([^/]+)\/artifacts\/([^/]+)\/promote-job$/);
  if (req.method === 'POST' && sessionPromoteMatch) {
    const sessionId = decodeURIComponent(sessionPromoteMatch[1]);
    const artifactId = decodeURIComponent(sessionPromoteMatch[2]);
    const store = readSessionsStore();
    const session = store.sessions.find(item => item.id === sessionId);
    const artifact = (store.artifacts[sessionId] || []).find(item => item.id === artifactId);
    if (!session || !artifact) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'artifact not found' })); return; }
    const job = {
      id: crypto.randomUUID(),
      kind: 'session-artifact',
      fileId: artifact.fileId,
      instr: `${session.agent === 'codex' ? 'Codex' : 'Claude'} 세션 산출물 검토`,
      sel: `세션 산출물 · ${session.title}`,
      state: 'done',
      proposed: artifact.proposedContent || '',
      artifactId,
      source: session.agent,
      sessionId,
      turnId: artifact.turnId || '',
    };
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ job }));
    return;
  }

  const sessionTurnMatch = url.pathname.match(/^\/sessions\/([^/]+)\/turn$/);
  const sessionTurnStopMatch = url.pathname.match(/^\/sessions\/([^/]+)\/turn\/stop$/);
  if (req.method === 'POST' && sessionTurnStopMatch) {
    const sessionId = decodeURIComponent(sessionTurnStopMatch[1]);
    const active = agentProcesses.get(sessionId);
    if (!active) {
      res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'running turn not found' }));
      return;
    }
    agentProcesses.stop(sessionId, '사용자가 중단했습니다.');
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessionId, turnId: active.turnId }));
    return;
  }

  if (req.method === 'POST' && sessionTurnMatch) {
    const sessionId = decodeURIComponent(sessionTurnMatch[1]);
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const message = String(payload.message || '').trim();
    if (!message) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'message required' })); return; }
    const store = readSessionsStore();
    const session = store.sessions.find(item => item.id === sessionId);
    if (!session) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'session not found' })); return; }
    const spawnSpec = sessionSpawnSpec(session, '');
    const hasAgent = await commandExists(spawnSpec.requiresCommand);
    if (!hasAgent) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      res.write(`data: ${JSON.stringify({ type: 'turn.error', error: `${session.agent} 실행 파일을 찾을 수 없습니다.` })}\n\n`);
      res.end();
      return;
    }
    // Re-check after the async command probe. Another request may have started
    // a turn while this handler was waiting; registering it would otherwise
    // overwrite the first process and make that process impossible to stop.
    if (bridgeShuttingDown) {
      res.writeHead(503, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bridge is shutting down' }));
      return;
    }
    if (agentProcesses.has(sessionId)) {
      res.writeHead(409, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'turn already running' }));
      return;
    }
    if (agentProcesses.list().length >= MAX_ACTIVE_AGENT_TURNS) {
      res.writeHead(429, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'too many active agent turns' }));
      return;
    }

    const now = new Date().toISOString();
    const turnId = crypto.randomUUID();
    const messages = store.messages[sessionId] || [];
    const userMessage = {
      id: crypto.randomUUID(),
      turnId,
      role: 'user',
      text: message,
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      outputHints: payload.outputHints && typeof payload.outputHints === 'object' ? payload.outputHints : {},
      createdAt: now,
    };
    messages.push(userMessage);
    session.status = 'running';
    session.lastTurnId = turnId;
    session.updatedAt = now;
    store.messages[sessionId] = messages;
    writeSessionsStore(store);
    appendSessionLog(sessionId, {
      type: 'turn.user',
      turnId,
      messageId: userMessage.id,
      chars: message.length,
      attachments: userMessage.attachments.length,
    });

    const outputHints = payload.outputHints || {};
    const contextMode = chooseContextMode({
      message,
      attachments: userMessage.attachments,
      explicitMode: outputHints.contextMode,
    });
    const compactInstructions = !['document', 'project', 'full'].includes(contextMode);
    const promptPackage = buildSessionPromptPackage({
      root: ROOT,
      session,
      previousMessages: messages.slice(0, -1),
      message,
      attachments: userMessage.attachments,
      outputHints: { ...outputHints, contextMode },
      requiredInstructions: instructionPromptBlock({ compact: compactInstructions }),
    });
    const { prompt } = promptPackage;
    const promptPackageSummary = summarizePromptPackageMetadata(promptPackage.metadata);
    userMessage.promptPackageSummary = promptPackageSummary;
    store.messages[sessionId] = messages;
    writeSessionsStore(store);
    const runtime = readAgentRuntime();
    appendSessionLog(sessionId, {
      type: 'turn.started',
      turnId,
      promptPackage: promptPackage.metadata,
      promptPackageSummary,
      runtime,
    });
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    const send = data => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
    };
    send({ type: 'turn.started', session: summarizeSession(session), turnId, promptPackage: promptPackage.metadata, promptPackageSummary, runtime });
    const turnStartedAt = Date.now();

    const { spawnArgs, stdinText } = sessionSpawnSpec(session, prompt);
    const resolved = resolveSpawn(spawnArgs[0], spawnArgs.slice(1));
    const proc = spawn(resolved.cmd, resolved.args, {
      cwd: ROOT,
      env: cliEnv(),
      stdio: [stdinText ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Give each agent turn its own POSIX process group. This lets both the
      // bridge and Electron terminate MCP/tool descendants, not just the CLI.
      detached: process.platform !== 'win32',
    });
    proc._docpilotOwnsProcessGroup = process.platform !== 'win32';
    proc._docpilotGroupId = turnId;
    notifyAgentGroup(proc, 'agent-group-started');
    if (stdinText) proc.stdin.end(stdinText);

    let killed = false;
    let full = '';
    let jsonBuf = '';
    let claudeFinalText = '';
    let outputSeen = false;
    function markSessionIdle() {
      const fresh = readSessionsStore();
      const freshSession = fresh.sessions.find(item => item.id === sessionId);
      if (freshSession && freshSession.status === 'running') {
        freshSession.status = 'idle';
        freshSession.updatedAt = new Date().toISOString();
        writeSessionsStore(fresh);
      }
      return freshSession;
    }
    function stopTurn(reason = '중단되었습니다.') {
      if (killed) return;
      killed = true;
      clearInterval(progressTimer);
      agentProcesses.clear(sessionId);
      stopAgentProcess(proc);
      markSessionIdle();
      appendSessionLog(sessionId, { type: 'turn.stopped', turnId, reason });
      send({ type: 'turn.stopped', sessionId, turnId, error: reason });
      try { res.end(); } catch {}
    }
    const progressTimer = setInterval(() => {
      send({
        type: 'turn.progress',
        sessionId,
        turnId,
        phase: outputSeen ? 'streaming' : 'waiting',
        elapsedMs: Date.now() - turnStartedAt,
      });
    }, 2000);
    function sendAssistantDelta(text) {
      if (!text) return;
      outputSeen = true;
      full += text;
      send({ type: 'turn.delta', sessionId, turnId, text });
    }
    proc.stdout.on('data', chunk => {
      if (session.agent === 'codex') {
        jsonBuf += chunk.toString();
        const lines = jsonBuf.split('\n');
        jsonBuf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
              sendAssistantDelta(ev.item.text);
            }
          } catch {}
        }
      } else {
        jsonBuf += chunk.toString();
        const lines = jsonBuf.split('\n');
        jsonBuf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'stream_event') {
              const streamEvent = ev.event || {};
              const delta = streamEvent.delta || {};
              const contentBlock = streamEvent.content_block || {};
              if (streamEvent.type === 'content_block_delta' && delta.type === 'text_delta') {
                sendAssistantDelta(String(delta.text || ''));
              } else if (streamEvent.type === 'content_block_start' && contentBlock.type === 'text' && contentBlock.text) {
                sendAssistantDelta(String(contentBlock.text || ''));
              }
            } else if (ev.type === 'assistant') {
              claudeFinalText = textFromClaudeContent(ev.message?.content);
            } else if (ev.type === 'result' && ev.result) {
              claudeFinalText = String(ev.result || claudeFinalText);
            }
          } catch {
            sendAssistantDelta(line.endsWith('\n') ? line : `${line}\n`);
          }
        }
      }
    });
    proc.stderr.on('data', chunk => process.stderr.write(chunk));
    proc.on('close', code => {
      finishAgentProcess(proc);
      if (killed) return;
      clearInterval(progressTimer);
      agentProcesses.clear(sessionId);
      const fresh = readSessionsStore();
      const freshSession = fresh.sessions.find(item => item.id === sessionId);
      if (code === 0) {
        if (!full && claudeFinalText) full = claudeFinalText;
        const assistantMessage = {
          id: crypto.randomUUID(),
          turnId,
          role: 'assistant',
          text: full,
          promptPackageSummary,
          createdAt: new Date().toISOString(),
        };
        fresh.messages[sessionId] = [...(fresh.messages[sessionId] || []), assistantMessage];
        const sessionMessages = fresh.messages[sessionId];
        const fallbackFileId = payload.outputHints?.targetFileId || userMessage.attachments.find(a => a.fileId)?.fileId || '';
        const preferArtifacts = Array.isArray(payload.outputHints?.preferArtifacts) ? payload.outputHints.preferArtifacts : [];
        const patchArtifacts = extractSessionArtifacts(full, fallbackFileId);
        const fileOpsArtifacts = payload.outputHints?.turnType === 'project' || preferArtifacts.includes('file-ops')
          ? extractFileOpsArtifacts(full)
          : [];
        const artifacts = [...patchArtifacts, ...fileOpsArtifacts].map(item => ({
          ...item,
          turnId,
          promptPackageSummary,
        }));
        if (artifacts.length) fresh.artifacts[sessionId] = [...(fresh.artifacts[sessionId] || []), ...artifacts];
        if (freshSession) {
          freshSession.status = 'idle';
          freshSession.updatedAt = assistantMessage.createdAt;
          freshSession.lastTurnId = turnId;
          refreshSessionSummary(freshSession, sessionMessages);
        }
        writeSessionsStore(fresh);
        appendSessionLog(sessionId, {
          type: 'turn.assistant',
          turnId,
          messageId: assistantMessage.id,
          chars: full.length,
          artifacts: artifacts.length,
          summaryChars: freshSession ? String(freshSession.summary || '').length : 0,
          summaryMessageCount: freshSession ? Number(freshSession.summaryMessageCount || 0) : 0,
          promptPackageSummary,
        });
        for (const artifact of artifacts) {
          appendSessionLog(sessionId, {
            type: 'artifact.created',
            turnId,
            artifactId: artifact.id,
            kind: artifact.kind,
            fileId: artifact.fileId || '',
            promptPackageSummary,
          });
          send({ type: 'artifact.created', sessionId, turnId, artifact });
        }
        send({ type: 'turn.done', sessionId, turnId, message: assistantMessage, session: freshSession ? summarizeSession(freshSession) : null });
      } else {
        if (freshSession) {
          freshSession.status = 'errored';
          freshSession.updatedAt = new Date().toISOString();
          writeSessionsStore(fresh);
        }
        appendSessionLog(sessionId, { type: 'turn.error', turnId, code, error: `${session.agent} 실패 (exit code ${code})` });
        send({ type: 'turn.error', sessionId, turnId, error: `${session.agent} 실패 (exit code ${code})` });
      }
      try { res.end(); } catch {}
    });
    proc.on('error', err => {
      finishAgentProcess(proc);
      clearInterval(progressTimer);
      agentProcesses.clear(sessionId);
      send({ type: 'turn.error', sessionId, turnId, error: err.message });
      try { res.end(); } catch {}
    });
    agentProcesses.register(sessionId, { turnId, proc, stop: stopTurn });
    res.on('close', () => {
      if (!killed) {
        killed = true;
        clearInterval(progressTimer);
        agentProcesses.clear(sessionId);
        stopAgentProcess(proc);
        markSessionIdle();
      }
    });
    return;
  }

  // GET /instructions — project instruction registry
  if (req.method === 'GET' && url.pathname === '/instructions') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(instructionStatePayload()));
    return;
  }

  // POST /instructions — create or update an instruction
  if (req.method === 'POST' && url.pathname === '/instructions') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const next = normalizeInstructionInput(payload);
    if (!next) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'instruction body required' })); return; }

    const store = readInstructionsStore();
    const global = readGlobalInstructionSetsStore();
    const index = store.instructions.findIndex(item => item.id === next.id);
    const previous = index === -1 ? null : store.instructions[index];
    if (index === -1) store.instructions.push(next);
    else store.instructions[index] = { ...store.instructions[index], ...next };
    if (previous && previous.active !== next.active) {
      if (store.activeSetId?.startsWith('global:')) global.activeSetId = '';
      store.activeSetId = '';
    }
    writeInstructionsStore(store);
    if (previous && previous.active !== next.active) writeGlobalInstructionSetsStore(global);

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, instruction: next, ...instructionStatePayload(store, global) }));
    return;
  }

  // POST /instructions/delete — delete an instruction
  if (req.method === 'POST' && url.pathname === '/instructions/delete') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const store = readInstructionsStore();
    const global = readGlobalInstructionSetsStore();
    if ((store.instructions || []).some(item => item.id === payload.id && item.active)) {
      if (store.activeSetId?.startsWith('global:')) global.activeSetId = '';
      store.activeSetId = '';
    }
    store.instructions = store.instructions.filter(item => item.id !== payload.id);
    store.sets = (store.sets || []).map(set => ({
      ...set,
      instructionIds: (set.instructionIds || []).filter(id => id !== payload.id),
    }));
    writeInstructionsStore(store);
    writeGlobalInstructionSetsStore(global);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...instructionStatePayload(store, global) }));
    return;
  }

  // POST /instruction-sets/save — save current active instruction combination
  if (req.method === 'POST' && url.pathname === '/instruction-sets/save') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const project = readInstructionsStore();
    const requestedIds = Array.isArray(payload.instructionIds) ? new Set(payload.instructionIds) : null;
    const active = project.instructions.filter(i => (requestedIds ? requestedIds.has(i.id) : i.active) && i.active);
    const next = normalizeInstructionSetInput(payload, active);
    if (!next) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'set name and active instructions required' })); return; }

    if (next.scope === 'global') {
      const global = readGlobalInstructionSetsStore();
      const index = global.sets.findIndex(item => item.id === next.id);
      if (index === -1) global.sets.push(next);
      else global.sets[index] = { ...global.sets[index], ...next };
      global.activeSetId = next.id;
      project.activeSetId = `global:${next.id}`;
      writeGlobalInstructionSetsStore(global);
      writeInstructionsStore(project);
    } else {
      const index = project.sets.findIndex(item => item.id === next.id);
      if (index === -1) project.sets.push(next);
      else project.sets[index] = { ...project.sets[index], ...next };
      project.activeSetId = next.id;
      writeInstructionsStore(project);
    }

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...instructionStatePayload() }));
    return;
  }

  // POST /instruction-sets/apply — activate a saved instruction set
  if (req.method === 'POST' && url.pathname === '/instruction-sets/apply') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const scope = payload.scope === 'global' ? 'global' : 'project';
    const id = String(payload.id || '');
    const project = readInstructionsStore();
    const global = readGlobalInstructionSetsStore();
    const set = scope === 'global'
      ? global.sets.find(item => item.id === id)
      : project.sets.find(item => item.id === id);
    if (!set) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'set not found' })); return; }

    let activeIds = new Set(set.instructionIds || []);
    if (scope === 'global') {
      activeIds = new Set();
      for (const snap of set.instructions || []) {
        if (!snap.body) continue;
        let item = project.instructions.find(i => i.globalSourceId === snap.id)
          || project.instructions.find(i => i.title === snap.title && i.body === snap.body);
        if (!item) {
          item = {
            id: crypto.randomUUID(),
            title: snap.title || 'Untitled instruction',
            body: snap.body,
            active: true,
            sourceType: snap.sourceType || 'global-set',
            sourceRef: set.name,
            globalSourceId: snap.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          project.instructions.push(item);
        } else {
          item.title = snap.title || item.title;
          item.body = snap.body || item.body;
          item.sourceType = snap.sourceType || item.sourceType || 'global-set';
          item.sourceRef = snap.sourceRef || item.sourceRef || set.name;
          item.globalSourceId = snap.id;
          item.updatedAt = new Date().toISOString();
        }
        activeIds.add(item.id);
      }
      global.activeSetId = set.id;
      project.activeSetId = `global:${set.id}`;
      writeGlobalInstructionSetsStore(global);
    } else {
      project.activeSetId = set.id;
    }
    project.instructions = project.instructions.map(item => ({ ...item, active: activeIds.has(item.id) }));
    writeInstructionsStore(project);

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...instructionStatePayload(project, global) }));
    return;
  }

  // POST /instruction-sets/delete — delete a saved instruction set
  if (req.method === 'POST' && url.pathname === '/instruction-sets/delete') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const scope = payload.scope === 'global' ? 'global' : 'project';
    const id = String(payload.id || '');
    const project = readInstructionsStore();
    const global = readGlobalInstructionSetsStore();
    if (scope === 'global') {
      global.sets = global.sets.filter(item => item.id !== id);
      if (global.activeSetId === id) global.activeSetId = '';
      if (project.activeSetId === `global:${id}`) project.activeSetId = '';
      writeGlobalInstructionSetsStore(global);
      writeInstructionsStore(project);
    } else {
      project.sets = project.sets.filter(item => item.id !== id);
      if (project.activeSetId === id) project.activeSetId = '';
      writeInstructionsStore(project);
    }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...instructionStatePayload(project, global) }));
    return;
  }

  // POST /instructions/normalize — turn natural language into a concise rule
  if (req.method === 'POST' && url.pathname === '/instructions/normalize') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const raw = String(payload.text || '').trim();
    if (!raw) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'text required' })); return; }

    let normalized = fallbackInstruction(raw);
    if (await commandExists('claude')) {
      const prompt = `Convert the user's rough writing instruction into a concise, enforceable document editing rule.

Return ONLY JSON with this shape:
{"title":"short title","body":"clear rule text"}

Rules:
- Keep the title under 80 characters.
- Make the body specific and testable.
- Preserve the user's intent.
- Do not add requirements the user did not imply.
- Write in the same language as the user's input.

User input:
\`\`\`
${raw}
\`\`\``;
      try {
        const out = await runCommandWithInput('claude', ['-p'], prompt, 45000);
        const parsed = JSON.parse(out.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
        normalized = {
          title: String(parsed.title || normalized.title).trim().slice(0, 120),
          body: String(parsed.body || normalized.body).trim(),
        };
      } catch {}
    }

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(normalized));
    return;
  }

  // GET /file?id=REL_PATH — 파일 내용 반환
  if (req.method === 'GET' && url.pathname === '/file') {
    const id = url.searchParams.get('id');
    if (!id) { res.writeHead(400, CORS); res.end(); return; }
    const resolved = resolveWorkspaceFileId(id);
    if (!resolved) { res.writeHead(403, CORS); res.end(); return; }
    try {
      const content = fs.readFileSync(resolved.abs, 'utf8');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, content, revision: fileRevision(content) }));
    } catch {
      res.writeHead(404, CORS); res.end();
    }
    return;
  }

  // GET /file-base?id=REL_PATH — git HEAD 기준 파일 내용 반환
  if (req.method === 'GET' && url.pathname === '/file-base') {
    const id = url.searchParams.get('id');
    if (!id) { res.writeHead(400, CORS); res.end(); return; }
    const resolved = resolveWorkspaceFileId(id);
    if (!resolved) { res.writeHead(403, CORS); res.end(); return; }
    if (resolved.isWorkspaceRoot) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, content: '', revision: fileRevision(''), source: 'workspace-root' }));
      return;
    }
    try {
      const content = await runGitShowFile(id);
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, content, revision: fileRevision(content), source: 'git-head' }));
    } catch {
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, content: '', revision: fileRevision(''), source: 'empty' }));
    }
    return;
  }

  // POST /save — 파일 저장 { id, content }
  if (req.method === 'POST' && url.pathname === '/save') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const { id, content } = payload;
    const expectedRevision = typeof payload.expectedRevision === 'string' ? payload.expectedRevision : '';
    if (!id || content == null) { res.writeHead(400, CORS); res.end(); return; }
    const resolved = resolveWorkspaceFileId(id);
    if (!resolved) { res.writeHead(403, CORS); res.end(); return; }
    try {
      const currentContent = fs.readFileSync(resolved.abs, 'utf8');
      const currentRevision = fileRevision(currentContent);
      if (expectedRevision && expectedRevision !== currentRevision) {
        res.writeHead(409, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'file changed on disk; reload or review the conflict before saving', revision: currentRevision }));
        return;
      }
      writeExistingWorkspaceFileAtomic(resolved.abs, content, currentRevision);
      const revision = fileRevision(content);
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, revision }));
      console.log(`[${new Date().toLocaleTimeString()}] saved ${id}`);
    } catch (err) {
      if (err?.code === 'SAVE_CONFLICT') {
        res.writeHead(409, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, revision: err.revision }));
        return;
      }
      res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /file-path?id=REL_PATH — absolute local path for copy/show actions
  if (req.method === 'GET' && url.pathname === '/file-path') {
    const id = url.searchParams.get('id');
    if (!id) { res.writeHead(400, CORS); res.end(); return; }
    const resolved = resolveWorkspaceDirectoryId(id) || resolveWorkspaceFileId(id);
    if (!resolved) { res.writeHead(403, CORS); res.end(); return; }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, path: resolved.abs }));
    return;
  }

  // POST /file-create — create a markdown file in a workspace directory
  if (req.method === 'POST' && url.pathname === '/file-create') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const dir = resolveWorkspaceDirectoryId(payload.dir || '');
    const rawName = String(payload.name || '').trim().replace(/\\/g, '/');
    if (!dir || !rawName || rawName.includes('/') || rawName.startsWith('.')) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'invalid file name' })); return; }
    const parsed = path.parse(rawName);
    const ext = parsed.ext || '.md';
    if (!DOC_EXTENSIONS.has(ext.toLowerCase())) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'unsupported file extension' })); return; }
    const fileName = parsed.ext ? rawName : `${rawName}.md`;
    const abs = path.resolve(dir.abs, fileName);
    if (!abs.startsWith(dir.root.path + path.sep) && abs !== dir.root.path) { res.writeHead(403, CORS); res.end(); return; }
    try {
      fs.writeFileSync(abs, String(payload.content || ''), { encoding: 'utf8', flag: 'wx' });
      const id = fileIdForResolvedAbs(abs, dir.root);
      const { files, folders, roots } = await collectProjectFiles();
      scheduleProjectChange('file-created');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, files, folders, roots }));
    } catch (err) {
      const status = err?.code === 'EEXIST' ? 409 : 500;
      res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 409 ? 'file already exists' : err.message }));
    }
    return;
  }

  // POST /folder-create — create a folder in a workspace directory
  if (req.method === 'POST' && url.pathname === '/folder-create') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const dir = resolveWorkspaceDirectoryId(payload.dir || '');
    const rawName = String(payload.name || '').trim().replace(/\\/g, '/');
    if (!dir || !rawName || rawName.includes('/') || rawName.startsWith('.') || HIDDEN_DIRS.has(rawName)) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ error: 'invalid folder name' }));
      return;
    }
    const abs = path.resolve(dir.abs, rawName);
    if (!abs.startsWith(dir.root.path + path.sep) && abs !== dir.root.path) { res.writeHead(403, CORS); res.end(); return; }
    if (fs.existsSync(abs)) { res.writeHead(409, CORS); res.end(JSON.stringify({ error: 'folder already exists' })); return; }
    let created = false;
    try {
      fs.mkdirSync(abs, { recursive: false });
      created = true;
      fs.writeFileSync(
        path.join(abs, FOLDER_STARTER_DOC_NAME),
        `# ${rawName}\n\n수정이 필요한 예시 문서입니다.\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      const id = fileIdForResolvedAbs(abs, dir.root);
      const { files, folders, roots } = await collectProjectFiles();
      scheduleProjectChange('folder-created');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, files, folders, roots }));
    } catch (err) {
      if (created) {
        try { fs.rmdirSync(abs); } catch {}
      }
      const status = err?.code === 'EEXIST' ? 409 : 500;
      res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 409 ? 'folder already exists' : err.message }));
    }
    return;
  }

  // POST /file-rename — rename one visible workspace file or folder in-place
  if (req.method === 'POST' && url.pathname === '/file-rename') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const resolved = resolveWorkspaceFileId(payload.id) || resolveWorkspaceDirectoryId(payload.id);
    const rawName = String(payload.name || '').trim().replace(/\\/g, '/');
    if (!resolved || !rawName || rawName.includes('/') || rawName.startsWith('.')) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'invalid rename request' })); return; }
    if (isWorkspaceRootResolved(resolved)) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'cannot rename workspace root' })); return; }
    const stat = fs.existsSync(resolved.abs) ? fs.lstatSync(resolved.abs) : null;
    if (!stat) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'not found' })); return; }
    const nextName = stat.isDirectory()
      ? rawName
      : (path.parse(rawName).ext ? rawName : `${rawName}${path.extname(resolved.abs) || '.md'}`);
    if (stat.isDirectory() && (nextName.startsWith('.') || HIDDEN_DIRS.has(nextName))) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ error: 'invalid folder name' }));
      return;
    }
    if (!stat.isDirectory() && !DOC_EXTENSIONS.has(path.extname(nextName).toLowerCase())) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ error: 'unsupported file extension' }));
      return;
    }
    const nextAbs = path.resolve(path.dirname(resolved.abs), nextName);
    if (!nextAbs.startsWith(resolved.root.path + path.sep) && nextAbs !== resolved.root.path) { res.writeHead(403, CORS); res.end(); return; }
    if (fs.existsSync(nextAbs)) { res.writeHead(409, CORS); res.end(JSON.stringify({ error: 'target already exists' })); return; }
    try {
      renamePathNoClobber(resolved.abs, nextAbs, stat);
      const id = fileIdForResolvedAbs(nextAbs, resolved.root);
      const { files, folders, roots } = await collectProjectFiles();
      scheduleProjectChange('file-renamed');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, files, folders, roots }));
    } catch (err) {
      const status = err?.code === 'EEXIST' ? 409 : 500;
      res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 409 ? 'target already exists' : err.message }));
    }
    return;
  }

  // POST /file-delete — move one visible workspace file or folder to recoverable trash
  if (req.method === 'POST' && url.pathname === '/file-delete') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const resolved = resolveWorkspaceFileId(payload.id) || resolveWorkspaceDirectoryId(payload.id);
    const permanent = payload.permanent === true;
    if (!resolved || isWorkspaceRootResolved(resolved)) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ error: 'invalid delete request' }));
      return;
    }
    let stat;
    try { stat = fs.lstatSync(resolved.abs); } catch {
      res.writeHead(404, CORS);
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (stat.isSymbolicLink()) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ error: 'cannot delete symlink' }));
      return;
    }
    try {
      let trashId = '';
      if (permanent) {
        fs.rmSync(resolved.abs, { recursive: stat.isDirectory(), force: false });
      } else {
        const trashPath = recoverableTrashPath(resolved);
        await movePathToRecoverableTrashAsync(resolved.abs, trashPath);
        trashId = path.relative(STATE_DIR, trashPath).replace(/\\/g, '/');
      }
      const { files, folders, roots } = await collectProjectFiles();
      scheduleProjectChange(permanent ? 'file-discarded' : 'file-deleted');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        deletedId: resolved.id,
        trashId,
        files,
        folders,
        roots,
      }));
    } catch (err) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /file-ops/apply — safely apply proposed project file operations
  if (req.method === 'POST' && url.pathname === '/file-ops/apply') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const result = await applyFileOperations(payload.operations || []);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...result }));
    return;
  }

  // POST /project-chat — project-level conversational instruction
  if (req.method === 'POST' && url.pathname === '/project-chat') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { respondInvalidRequestBody(res, error); return; }
    const instruction = String(payload.instruction || '').trim();
    const requestedAgent = ['claude', 'codex'].includes(payload.agent) ? payload.agent : '';
    if (!instruction) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'instruction required' })); return; }

    res.writeHead(200, {
      ...CORS,
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'X-Accel-Buffering': 'no',
    });

    const send = data => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    const agent = requestedAgent || 'claude';
    const session = createSessionRecord({
      agent,
      title: `${agent === 'codex' ? 'Codex' : 'Claude'} 프로젝트 세션`,
      scope: {
        type: 'project',
        id: String(payload.scopeId || payload.fileId || '.').slice(0, 500),
        currentFileId: String(payload.fileId || '').slice(0, 500),
      },
    });
    send({ parallel: false, agent, session: summarizeSession(session), compatibility: 'session-turn' });

    const turnPayload = JSON.stringify({
      message: instruction,
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      outputHints: {
        ...(payload.outputHints && typeof payload.outputHints === 'object' ? payload.outputHints : {}),
        contextMode: payload.contextMode || payload.outputHints?.contextMode || 'project',
        turnType: 'project',
        promptMode: payload.promptMode || payload.outputHints?.promptMode || 'refine',
        preferArtifacts: ['file-ops'],
      },
    });
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      method: 'POST',
      path: `/sessions/${encodeURIComponent(session.id)}/turn`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(turnPayload),
        ...(BRIDGE_TOKEN ? { 'X-DocPilot-Token': BRIDGE_TOKEN } : {}),
      },
    }, proxyRes => {
      let buffer = '';
      let responseText = '';
      const artifacts = [];
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => {
        buffer += chunk;
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const dataLine = part.split('\n').find(line => line.startsWith('data:'));
          if (!dataLine) continue;
          let event;
          try { event = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
          if (event.type === 'turn.started') {
            send({
              source: agent,
              started: true,
              session: event.session,
              turnId: event.turnId,
              promptPackage: event.promptPackage,
              promptPackageSummary: event.promptPackageSummary,
            });
          } else if (event.type === 'turn.delta') {
            responseText += event.text || '';
            send({ source: agent, chunk: event.text || '' });
          } else if (event.type === 'artifact.created') {
            if (event.artifact) artifacts.push(event.artifact);
            send({ source: agent, artifact: event.artifact });
          } else if (event.type === 'turn.done') {
            send({
              source: agent,
              done: true,
              response: event.message?.text || responseText,
              proposed: event.message?.text || responseText,
              artifacts,
              session: event.session,
              turnId: event.turnId,
            });
          } else if (event.type === 'turn.error' || event.type === 'turn.stopped') {
            send({ source: agent, error: event.error || '프로젝트 세션이 중단되었습니다.', sessionId: session.id, turnId: event.turnId });
          } else if (event.type === 'turn.progress') {
            send({ source: agent, progress: true, phase: event.phase, elapsedMs: event.elapsedMs, turnId: event.turnId });
          }
        }
      });
      proxyRes.on('end', () => {
        try { res.end(); } catch {}
      });
    });
    proxyReq.on('error', err => {
      send({ source: agent, error: `project-chat wrapper failed: ${err.message}` });
      try { res.end(); } catch {}
    });
    proxyReq.end(turnPayload);
    res.on('close', () => {
      try { proxyReq.destroy(); } catch {}
      agentProcesses.stop(session.id, 'project-chat client closed');
    });
    return;
  }

  // GET /tool-info?tool=claude|codex — version, path, masked API key
  if (req.method === 'GET' && url.pathname === '/tool-info') {
    const tool = url.searchParams.get('tool');
    if (tool !== 'claude' && tool !== 'codex') {
      res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'invalid tool' })); return;
    }
    const result = { tool, path: findCommand(tool), version: null, envKey: null, envMasked: null };
    try { result.version = await runTextCommand(tool, ['--version'], 5000); } catch {}
    const envKeys = tool === 'claude'
      ? ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']
      : ['OPENAI_API_KEY', 'CODEX_API_KEY'];
    for (const key of envKeys) {
      const val = process.env[key];
      if (val) { result.envKey = key; result.envMasked = val.slice(0, 12) + '***'; break; }
    }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // GET /codex-status — codex version, model, account info from JWT
  if (req.method === 'GET' && url.pathname === '/codex-status') {
    const result = {
      version: null,
      model: null,
      permissions: null,
      email: null,
      plan: null,
      org: null,
      limits: { fiveHour: null, weekly: null },
    };
    try { result.version = await runTextCommand('codex', ['--version'], 5000); } catch {}
    result.limits = await readCodexLimits();
    try {
      const home = process.env.HOME || require('os').homedir();
      const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
      const modelMatch = toml.match(/^model\s*=\s*"([^"]+)"/m);
      if (modelMatch) result.model = modelMatch[1];
      const sandboxMatch = toml.match(/^sandbox_mode\s*=\s*"([^"]+)"/m);
      if (sandboxMatch) result.permissions = sandboxMatch[1];
    } catch {}
    try {
      const home = process.env.HOME || require('os').homedir();
      const auth = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'auth.json'), 'utf8'));
      const idToken = auth?.tokens?.id_token;
      if (idToken) {
        const payload = idToken.split('.')[1];
        const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
        const decoded = JSON.parse(Buffer.from(padded, 'base64url').toString('utf8'));
        result.email = decoded.email || null;
        const openaiAuth = decoded['https://api.openai.com/auth'] || {};
        result.plan = openaiAuth.chatgpt_plan_type || null;
        const orgs = openaiAuth.organizations || [];
        const defaultOrg = orgs.find(o => o.is_default) || orgs[0];
        result.org = defaultOrg?.title || null;
      }
    } catch {}
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // GET /claude-status — claude version, auth, model, MCP servers
  if (req.method === 'GET' && url.pathname === '/claude-status') {
    const result = {
      version: null,
      auth: null,
      model: null,
      mcpServers: null,
      limits: { fiveHour: null, weekly: null },
    };
    try { result.version = await runTextCommand('claude', ['--version'], 5000); } catch {}
    result.limits = await readClaudeLimits();
    try {
      const authOut = await runTextCommand('claude', ['auth', 'status'], 5000);
      result.auth = JSON.parse(authOut);
    } catch {}
    try {
      const home = process.env.HOME || require('os').homedir();
      const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
      result.model = settings.model || null;
      const servers = settings.mcpServers || {};
      const names = Object.keys(servers);
      let healthyCount = 0;
      try {
        const cache = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'mcp-health-cache.json'), 'utf8'));
        healthyCount = names.filter(n => cache.servers?.[n]?.status === 'healthy').length;
      } catch {}
      result.mcpServers = { total: names.length, healthy: healthyCount };
    } catch {}
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404, CORS); res.end();
}

const server = http.createServer((req, res) => {
  void handleBridgeRequest(req, res).catch(error => {
    console.error('bridge request failed:', error);
    if (res.headersSent) {
      try { res.destroy(); } catch {}
      return;
    }
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'internal bridge error' }));
  });
});

server.on('connection', socket => {
  if (serverConnections.size >= 64) {
    socket.destroy();
    return;
  }
  serverConnections.add(socket);
  socket.once('close', () => serverConnections.delete(socket));
});

let bridgeShutdownPromise = null;

function closeWatchClients() {
  for (const client of Array.from(watchClients)) {
    try { client.end(); } catch {}
  }
  watchClients.clear();
}

function stopActiveAgentTurns(reason) {
  for (const { sessionId } of agentProcesses.list()) {
    try { agentProcesses.stop(sessionId, reason); } catch {}
  }
}

function stopAllTerminalSessions(reason) {
  const stopped = [];
  for (const id of Array.from(terminalSessions.keys())) {
    try {
      const session = stopTerminalSession(id, reason);
      if (session) stopped.push(session);
    } catch {}
  }
  return stopped;
}

function stopAsciidocWorker(reason) {
  const error = new Error(`bridge shutdown: ${reason}`);
  for (const pending of asciidocWorkerPending.values()) pending.reject(error);
  asciidocWorkerPending.clear();
  const worker = asciidocWorker;
  asciidocWorker = null;
  if (worker) {
    try { void worker.terminate().catch(() => {}); } catch {}
  }
}

function shutdownBridge(reason = 'shutdown') {
  if (bridgeShutdownPromise) return bridgeShutdownPromise;
  bridgeShuttingDown = true;
  bridgeShutdownPromise = new Promise(resolve => {
    let finished = false;
    const forceRemainingTerminals = () => {
      const lateSessions = stopAllTerminalSessions(`bridge ${reason}`);
      for (const session of new Set([...lateSessions, ...stoppingTerminalSessions])) {
        forceTerminalSession(session);
      }
    };
    const forceRemainingAgents = () => {
      for (const proc of Array.from(stoppingAgentProcesses)) forceAgentProcess(proc);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      forceRemainingAgents();
      forceRemainingTerminals();
      resolve();
    };
    const deadline = setTimeout(() => {
      forceRemainingAgents();
      forceRemainingTerminals();
      try { server.closeAllConnections?.(); } catch {}
      for (const socket of Array.from(serverConnections)) {
        try { socket.destroy(); } catch {}
      }
      finish();
    }, BRIDGE_SHUTDOWN_TIMEOUT_MS);

    closeWatchClients();
    stopProjectWatch();
    stopActiveAgentTurns(`bridge ${reason}`);
    forceRemainingAgents();
    const stoppedTerminalSessions = stopAllTerminalSessions(`bridge ${reason}`);
    // PTYs own a session outside the bridge process group. Escalate them
    // synchronously so Electron's own exit cannot interrupt the cleanup timer.
    for (const session of new Set([...stoppedTerminalSessions, ...stoppingTerminalSessions])) {
      forceTerminalSession(session);
    }
    stopAsciidocWorker(reason);

    try {
      server.close(finish);
      server.closeIdleConnections?.();
      if (!server.listening) queueMicrotask(finish);
    } catch {
      finish();
    }
  });
  return bridgeShutdownPromise;
}

function exitAfterBridgeShutdown(reason, exitCode = 0) {
  void shutdownBridge(reason).finally(() => process.exit(exitCode));
}

process.once('SIGTERM', () => exitAfterBridgeShutdown('SIGTERM'));
process.once('SIGINT', () => exitAfterBridgeShutdown('SIGINT', 130));
handleParentDisconnect = () => exitAfterBridgeShutdown('parent disconnect');
if (parentDisconnectRequested) handleParentDisconnect();

server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`docpilot bridge port ${PORT} is already in use`);
    process.exit(48);
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\ndocpilot bridge  http://localhost:${PORT}`);
  console.log(`root             ${ROOT}\n`);
});
