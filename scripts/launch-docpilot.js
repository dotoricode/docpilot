#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { ensurePrivateDirectory, writeJsonAtomic } = require('../shared/core/atomic-file');

const PORT = 7474;
const projectDir = path.resolve(__dirname, '..');
const bridgePath = path.join(projectDir, 'bridge.js');
const editorPath = path.join(projectDir, 'dist', 'renderer', 'index.html');
const launcherStateDir = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'DocPilot', 'launcher')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'DocPilot', 'launcher')
    : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'docpilot', 'launcher');
const statePath = path.join(launcherStateDir, `bridge-${PORT}.json`);
const logPath = path.join(launcherStateDir, 'bridge.log');

ensurePrivateDirectory(launcherStateDir);

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'vendor']);

function usage() {
  console.log(`Usage: node scripts/launch-docpilot.js [path]

Starts the docpilot bridge and opens the React renderer.
If path is omitted, docpilot searches the current directory for markdown folders.`);
}

function normalize(p) {
  return path.resolve(p);
}

function samePath(a, b) {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

function hasMarkdownFile(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some(entry => entry.isFile() && /\.md$/i.test(entry.name));
  } catch {
    return false;
  }
}

function findMarkdownDirs(root, maxDepth = 3) {
  const found = new Set();

  function walk(dir, depth) {
    if (hasMarkdownFile(dir)) found.add(dir);
    if (depth >= maxDepth) return;

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(root, 0);
  return [...found].sort((a, b) => a.localeCompare(b));
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function chooseRoot(argPath) {
  if (argPath) {
    const root = normalize(argPath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`${root} is not an existing directory`);
    }
    return root;
  }

  const candidates = findMarkdownDirs(process.cwd());
  if (candidates.length === 0) {
    throw new Error('No markdown files found under the current directory.');
  }
  if (candidates.length === 1) return candidates[0];

  console.log('Markdown directories:');
  candidates.forEach((candidate, index) => console.log(`  ${index + 1}) ${candidate}`));

  if (!process.stdin.isTTY) {
    throw new Error('Multiple markdown directories found. Run again with the path to open.');
  }

  const answer = await ask('\nWhich directory should docpilot open? (number) ');
  const index = Number(answer);
  if (!Number.isInteger(index) || index < 1 || index > candidates.length) {
    throw new Error('Invalid selection.');
  }
  return candidates[index - 1];
}

function ping(token = '') {
  return new Promise(resolve => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/ping',
      headers: token ? { 'X-DocPilot-Token': token } : {},
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.setTimeout(700, () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

async function waitForBridge(root, token) {
  for (let i = 0; i < 30; i += 1) {
    const status = await ping(token);
    if (status?.ok && samePath(status.root, root)) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

function readManagedState() {
  try {
    const stat = fs.lstatSync(statePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function killManagedBridge() {
  const pid = Number(readManagedState()?.pid);
  if (!pid) return false;
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

function startBridge(root) {
  const token = crypto.randomBytes(32).toString('base64url');
  const log = fs.openSync(logPath, 'a', 0o600);
  const child = spawn(process.execPath, [bridgePath, '--root', root], {
    cwd: projectDir,
    env: { ...process.env, DOCPILOT_BRIDGE_PORT: String(PORT), DOCPILOT_BRIDGE_TOKEN: token },
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  child.unref();
  writeJsonAtomic(statePath, {
    pid: child.pid,
    root,
    token,
    startedAt: new Date().toISOString(),
  });
  return token;
}

function openEditor(token) {
  if (!fs.existsSync(editorPath)) {
    throw new Error('React renderer bundle is missing. Run npm run renderer:build first.');
  }
  const url = new URL(pathToFileURL(editorPath).href);
  url.searchParams.set('port', String(PORT));
  url.searchParams.set('token', token);
  const editorUrl = url.toString();
  let child;
  if (process.platform === 'win32') {
    child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', editorUrl], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else if (process.platform === 'darwin') {
    child = spawn('open', [editorUrl], { detached: true, stdio: 'ignore' });
  } else {
    child = spawn('xdg-open', [editorUrl], { detached: true, stdio: 'ignore' });
  }
  child.on('error', () => {
    console.log('Could not open the renderer automatically. Run the Electron app instead.');
  });
  child.unref();
  return pathToFileURL(editorPath).href;
}

async function ensureBridge(root) {
  const managedState = readManagedState();
  const managedToken = typeof managedState?.token === 'string' ? managedState.token : '';
  const status = await ping(managedToken);
  if (status?.ok && samePath(status.root, root)) {
    return { message: 'bridge already running', token: managedToken };
  }

  if (status?.ok && !samePath(status.root, root)) {
    if (killManagedBridge()) {
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      throw new Error(`bridge is already running for another root: ${status.root}`);
    }
  }

  const token = startBridge(root);
  const ready = await waitForBridge(root, token);
  if (!ready) {
    throw new Error(`bridge did not become ready. See log: ${logPath}`);
  }
  return { message: 'bridge started', token };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const rootArg = args.find(arg => !arg.startsWith('-'));
  const root = await chooseRoot(rootArg);
  const bridgeState = await ensureBridge(root);
  const editorUrl = openEditor(bridgeState.token);

  console.log('docpilot ready');
  console.log(`  root   : ${root}`);
  console.log(`  bridge : http://127.0.0.1:${PORT} (${bridgeState.message})`);
  console.log(`  editor : ${editorUrl}`);
  console.log(`  log    : ${logPath}`);
}

main().catch(err => {
  console.error(`docpilot error: ${err.message}`);
  process.exit(1);
});
