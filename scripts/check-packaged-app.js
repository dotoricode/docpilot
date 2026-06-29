const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dmgPath = path.join(root, 'dist', `DocPilot-${pkg.version}.dmg`);
const appPath = path.join(root, 'dist', 'mac', 'DocPilot.app');
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

assert(fs.existsSync(dmgPath), `DMG missing: ${dmgPath}`);
assert(fs.statSync(dmgPath).size > 50 * 1024 * 1024, 'DMG looks too small to contain the Electron app');
assert(fs.existsSync(appPath), `packaged app missing: ${appPath}`);
assert(fs.existsSync(asarPath), `app.asar missing: ${asarPath}`);
assert(fs.existsSync(ptyPath), `node-pty native module missing: ${ptyPath}`);

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

const bridge = asar.extractFile(asarPath, 'bridge.js').toString('utf8');
assert(!/url\.pathname === '\/instruct'/.test(bridge), 'packaged bridge must not keep legacy /instruct route');
assert(!/url\.pathname === '\/editor\.html'/.test(bridge), 'packaged bridge must not keep legacy /editor.html route');

console.log('packaged app checks passed');
