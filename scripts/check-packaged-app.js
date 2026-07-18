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
const packagedArchitectures = [
  { arch: 'x64', fileArch: 'x86_64', dir: 'mac' },
  { arch: 'arm64', fileArch: 'arm64', dir: 'mac-arm64' },
];
const hostArchitecture = process.arch === 'arm64' ? 'arm64' : 'x64';
const hostPackage = packagedArchitectures.find(item => item.arch === hostArchitecture);
const appPath = path.join(packageOutput, hostPackage.dir, 'DocPilot.app');
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

function assertIconHasAlpha(iconPath, label) {
  assert(fs.existsSync(iconPath), `${label} missing: ${iconPath}`);
  const output = execFileSync('sips', ['-g', 'hasAlpha', iconPath], { encoding: 'utf8' });
  assert.match(output, /hasAlpha:\s*yes/i, `${label} must retain transparent outer pixels`);
}

function assertMountedDmgIcon(dmgPath, arch) {
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), `docpilot-${arch}-dmg-`));
  let mounted = false;
  try {
    execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPoint, dmgPath], {
      stdio: 'ignore',
    });
    mounted = true;
    const mountedApp = path.join(mountPoint, 'DocPilot.app');
    const mountedIcon = path.join(mountedApp, 'Contents', 'Resources', 'icon.icns');
    assertIconHasAlpha(mountedIcon, `${arch} mounted DMG app icon`);
    assertIconHasAlpha(path.join(mountPoint, '.VolumeIcon.icns'), `${arch} DMG volume icon`);
    const mountedVersion = execFileSync('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleShortVersionString',
      path.join(mountedApp, 'Contents', 'Info.plist'),
    ], { encoding: 'utf8' }).trim();
    assert.strictEqual(mountedVersion, pkg.version, `${arch} mounted DMG app version must match package.json`);
  } finally {
    if (mounted) execFileSync('hdiutil', ['detach', mountPoint], { stdio: 'ignore' });
    fs.rmSync(mountPoint, { recursive: true, force: true });
  }
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
  const canonicalRoot = fs.realpathSync.native(root);
  const port = await freePort();
  let output = '';
  const child = spawn(process.execPath, [unpackedBridgePath, '--root', root], {
    env: { ...process.env, DOCPILOT_BRIDGE_PORT: String(port), DOCPILOT_ALLOW_UNAUTHENTICATED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (child.exitCode != null) break;
      const ping = await fetchPing(port);
      if (ping?.ok && ping.root === canonicalRoot) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`packaged bridge did not start:\n${output}`);
  } finally {
    if (child.exitCode == null) child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  assertIconHasAlpha(path.join(root, 'assets', 'icon.png'), 'source PNG icon');
  assertIconHasAlpha(path.join(root, 'assets', 'docpilot.icns'), 'source ICNS icon');
  for (const target of packagedArchitectures) {
    const targetAppPath = path.join(packageOutput, target.dir, 'DocPilot.app');
    const targetDmgPath = path.join(packageOutput, `DocPilot-${pkg.version}-${target.arch}.dmg`);
    const targetPtyPath = path.join(
      targetAppPath,
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'pty.node',
    );
    assert(fs.existsSync(targetDmgPath), `DMG missing: ${targetDmgPath}`);
    assert(fs.statSync(targetDmgPath).size > 50 * 1024 * 1024, `${target.arch} DMG looks too small to contain the Electron app`);
    assert(fs.existsSync(targetAppPath), `packaged app missing: ${targetAppPath}`);
    assertIconHasAlpha(path.join(targetAppPath, 'Contents', 'Resources', 'icon.icns'), `${target.arch} packaged app icon`);
    assert.match(execFileSync('file', [path.join(targetAppPath, 'Contents', 'MacOS', 'DocPilot')], { encoding: 'utf8' }), new RegExp(`\\b${target.fileArch}\\b`));
    assert.match(execFileSync('file', [targetPtyPath], { encoding: 'utf8' }), new RegExp(`\\b${target.fileArch}\\b`));
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', targetAppPath], {
      stdio: 'inherit',
    });
    assertMountedDmgIcon(targetDmgPath, target.arch);
  }
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
    '/shared/core/update-controller.js',
    '/shared/core/update-download.js',
    '/shared/core/update-release.js',
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
