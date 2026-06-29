#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const bridgePath = path.join(repoRoot, 'bridge.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-file-ops-'));
const port = 19000 + Math.floor(Math.random() * 1000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function write(relPath, content) {
  const abs = path.join(tempRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

async function waitForBridge() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ping`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('bridge did not start');
}

async function main() {
  write('keep.md', '# keep\n');
  write('remove.md', '# remove\n');
  write('docs/adr/ADR-1.md', '# adr\n');

  const child = spawn(process.execPath, [bridgePath, '--root', tempRoot], {
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_BRIDGE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk.toString());

  try {
    await waitForBridge();
    const response = await fetch(`http://127.0.0.1:${port}/file-ops/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          { op: 'delete', path: 'remove.md', reason: 'absorbed' },
          { op: 'delete', path: 'docs/adr', reason: 'directory no longer allowed' },
          { op: 'delete', path: '../outside.md', reason: 'invalid' },
          { op: 'delete', path: '.docpilot/sessions.json', reason: 'protected' },
        ],
      }),
    });
    assert(response.ok, `apply failed: HTTP ${response.status}`);
    const data = await response.json();

    assert(data.applied.length === 2, `expected 2 applied ops, got ${data.applied.length}`);
    assert(data.skipped.length === 2, `expected 2 skipped ops, got ${data.skipped.length}`);
    assert(fs.existsSync(path.join(tempRoot, 'keep.md')), 'keep.md should remain');
    assert(!fs.existsSync(path.join(tempRoot, 'remove.md')), 'remove.md should move away');
    assert(!fs.existsSync(path.join(tempRoot, 'docs/adr')), 'docs/adr should move away');
    assert(fs.existsSync(path.join(tempRoot, data.trashRoot, 'remove.md')), 'remove.md should be in trash');
    assert(fs.existsSync(path.join(tempRoot, data.trashRoot, 'docs/adr/ADR-1.md')), 'adr file should be in trash');

    console.log('file-ops apply check passed');
  } finally {
    child.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (stderr.trim()) process.stderr.write(stderr);
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
