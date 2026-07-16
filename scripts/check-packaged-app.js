const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageOutput = path.join(root, pkg.build.directories.output);
const dmgPath = path.join(packageOutput, `DocPilot-${pkg.version}.dmg`);
const appPath = path.join(packageOutput, 'mac', 'DocPilot.app');
const plistPath = path.join(appPath, 'Contents', 'Info.plist');
const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
const ptyPath = path.join(
  appPath,
  'Contents',
  'Resources',
  'app.asar.unpacked',
  'node_modules',
  'node-pty',
  'build',
  'Release',
  'pty.node',
);
const unpackedBridgePath = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'bridge.js');
const unpackedAdocWorkerPath = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'adoc-worker.js');
const unpackedFakeAgentPath = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'scripts', 'fake-agent.js');
const unpackedContextPolicyPath = path.join(
  appPath,
  'Contents',
  'Resources',
  'app.asar.unpacked',
  'shared',
  'core',
  'context-policy.js',
);

function plistValue(key) {
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], {
    encoding: 'utf8',
  }).trim();
}

function listAsar() {
  return asar.listPackage(asarPath);
}

function readAsarJson(filePath) {
  return JSON.parse(asar.extractFile(asarPath, filePath).toString('utf8'));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function fetchPing(port) {
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
    req.setTimeout(300, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function assertPackagedBridgeStarts() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-packaged-bridge-'));
  const port = await freePort();
  let output = '';
  const child = spawn(process.execPath, [unpackedBridgePath, '--root', root], {
    env: { ...process.env, DOCPILOT_BRIDGE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (child.exitCode != null) break;
      const ping = await fetchPing(port);
      if (ping?.ok && ping.root === root) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`packaged bridge did not start:\n${output}`);
  } finally {
    if (child.exitCode == null) child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  assert(fs.existsSync(dmgPath), `DMG missing: ${dmgPath}`);
  assert(fs.statSync(dmgPath).size > 50 * 1024 * 1024, 'DMG looks too small to contain the Electron app');
  assert(fs.existsSync(appPath), `packaged app missing: ${appPath}`);
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  });
  assert(fs.existsSync(asarPath), `app.asar missing: ${asarPath}`);
  assert(fs.existsSync(ptyPath), `node-pty native module missing: ${ptyPath}`);
  assert(fs.existsSync(unpackedBridgePath), `unpacked bridge missing: ${unpackedBridgePath}`);
  assert(fs.existsSync(unpackedAdocWorkerPath), `unpacked adoc worker missing: ${unpackedAdocWorkerPath}`);
  assert(fs.existsSync(unpackedFakeAgentPath), `unpacked fake agent missing: ${unpackedFakeAgentPath}`);
  assert(fs.existsSync(unpackedContextPolicyPath), `unpacked bridge dependency missing: ${unpackedContextPolicyPath}`);

  assert.strictEqual(plistValue('CFBundleName'), 'DocPilot');
  assert.strictEqual(plistValue('CFBundleIdentifier'), 'com.docpilot.app');
  assert.strictEqual(plistValue('CFBundleShortVersionString'), pkg.version);

  const packagedPkg = readAsarJson('package.json');
  assert.strictEqual(packagedPkg.version, pkg.version, 'packaged package version must match source package');

  const files = new Set(listAsar());
  [
    '/main.js',
    '/preload.js',
    '/start.html',
    '/adoc-worker.js',
    '/bridge.js',
    '/prompt-package.js',
    '/dist/renderer/index.html',
    '/shared/core/context-policy.js',
    '/shared/core/file-buffer.js',
    '/shared/core/agent-process-manager.js',
    '/scripts/fake-agent.js',
    '/package.json',
  ].forEach(file => assert(files.has(file), `packaged file missing: ${file}`));

  assert(!files.has('/editor.html'), 'legacy editor.html must not be packaged');

  const main = asar.extractFile(asarPath, 'main.js').toString('utf8');
  assert(main.includes('win.loadFile(reactRendererPath'), 'packaged main must load React renderer');
  assert(!main.includes("win.loadFile('editor.html'"), 'packaged main must not load legacy editor');
  assert(!main.includes('DOCPILOT_LEGACY_RENDERER'), 'packaged main must not keep legacy renderer flag');
  assert(main.includes('setAboutPanelOptions'), 'packaged main must configure the macOS About panel');
  assert(main.includes('applicationVersion: app.getVersion()'), 'About panel must show the app package version');

  const bridge = asar.extractFile(asarPath, 'bridge.js').toString('utf8');
  assert(!/url\.pathname === '\/instruct'/.test(bridge), 'packaged bridge must not keep legacy /instruct route');
  assert(!/url\.pathname === '\/editor\.html'/.test(bridge), 'packaged bridge must not keep legacy /editor.html route');

  await assertPackagedBridgeStarts();

  console.log('packaged app checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
