const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function requestJson(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        resolve(data ? JSON.parse(data) : {});
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function waitForBridge(proc) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`bridge did not start:\n${output}`)), 8000);
    proc.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('docpilot bridge')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.stderr.on('data', chunk => { output += chunk.toString(); });
    proc.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`bridge exited early with ${code}:\n${output}`));
    });
  });
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-settings-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Root\n', 'utf8');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'ignored.md'), '# Ignore\n', 'utf8');
  const port = 17500 + Math.floor(Math.random() * 1000);
  const proc = spawn(process.execPath, [path.join(repoRoot, 'bridge.js'), '--root', root], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_BRIDGE_PORT: String(port),
      DOCPILOT_FAKE_AGENT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForBridge(proc);
    const initial = await requestJson(port, 'GET', '/settings');
    assert.strictEqual(initial.settings.theme, 'system');
    assert.strictEqual(initial.settings.agentCommandMode, 'auto');
    assert.strictEqual(initial.settings.claudeCommand, 'claude');
    assert.deepStrictEqual(initial.settings.recentWorkspaces, [root]);

    const saved = await requestJson(port, 'POST', '/settings', {
      settings: {
        autosave: true,
        theme: 'system',
        agentCommandMode: 'custom',
        claudeCommand: '/opt/bin/claude',
        codexCommand: '/opt/bin/codex',
        fileWatcherIgnore: 'dist/**',
        recentWorkspaces: ['/tmp/other', root],
      },
    });
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.settings.autosave, true);
    assert.strictEqual(saved.settings.agentCommandMode, 'custom');
    assert.strictEqual(saved.settings.codexCommand, '/opt/bin/codex');
    assert.deepStrictEqual(saved.settings.recentWorkspaces, ['/tmp/other', root]);

    const reloaded = await requestJson(port, 'GET', '/settings');
    assert.strictEqual(reloaded.settings.theme, 'system');
    assert.strictEqual(reloaded.settings.fileWatcherIgnore, 'dist/**');

    const files = await requestJson(port, 'GET', '/files');
    assert(files.files.includes('README.md'), 'workspace file collection should include normal markdown files');
    assert(!files.files.includes('dist/ignored.md'), 'fileWatcherIgnore should exclude matching markdown files');

    const diagnostics = await requestJson(port, 'GET', '/diagnostics');
    assert.strictEqual(diagnostics.diagnostics.root, root);
    assert.strictEqual(diagnostics.diagnostics.docpilotDir, path.join(root, '.docpilot'));
    assert.strictEqual(diagnostics.diagnostics.settingsFile, path.join(root, '.docpilot', 'settings.json'));
    assert.strictEqual(diagnostics.diagnostics.sessionLogsDir, path.join(root, '.docpilot', 'session-logs'));
    assert.strictEqual(typeof diagnostics.diagnostics.sessionLogCount, 'number');
    assert.strictEqual(typeof diagnostics.diagnostics.bridgePid, 'number');

    const runtime = await requestJson(port, 'GET', '/agent-runtime');
    assert.strictEqual(runtime.runtime.rendererTerminal, 'xterm');
    assert(['stream', 'node-pty'].includes(runtime.runtime.executionMode), 'runtime should report a known execution mode');
    assert.strictEqual(typeof runtime.runtime.ptyAvailable, 'boolean');
    assert.strictEqual(runtime.runtime.fallbackMode, 'child_process-sse');
    assert.strictEqual(runtime.runtime.commandMode, 'custom');
    assert.strictEqual(runtime.runtime.claudeCommand, '/opt/bin/claude');

    const persisted = JSON.parse(fs.readFileSync(path.join(root, '.docpilot', 'settings.json'), 'utf8'));
    assert.strictEqual(persisted.claudeCommand, '/opt/bin/claude');
    console.log('settings api check passed');
  } finally {
    proc.kill('SIGTERM');
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
