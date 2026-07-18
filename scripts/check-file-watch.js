#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const bridgePath = path.join(repoRoot, 'bridge.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-watch-'));
const attachedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-watch-attached-'));
const port = 20000 + Math.floor(Math.random() * 1000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function waitForWatchEvent() {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const req = http.get(`http://127.0.0.1:${port}/watch`, res => {
      if (res.statusCode !== 200) {
        req.destroy();
        reject(new Error(`watch failed: HTTP ${res.statusCode}`));
        return;
      }
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        const messages = buffer.split('\n\n');
        buffer = messages.pop();
        for (const message of messages) {
          const line = message.split('\n').find(item => item.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'files.changed') {
            req.destroy();
            resolve(event);
          }
        }
      });
    });
    req.on('error', err => {
      if (err.code === 'ECONNRESET') return;
      reject(err);
    });
    req.setTimeout(7000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function main() {
  const child = spawn(process.execPath, [bridgePath, '--root', tempRoot], {
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_BRIDGE_PORT: String(port), DOCPILOT_ALLOW_UNAUTHENTICATED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk.toString());

  try {
    await waitForBridge();
    const watchEvent = waitForWatchEvent();
    setTimeout(() => {
      fs.mkdirSync(path.join(tempRoot, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, 'docs', 'new-file.md'), '# New\n', 'utf8');
    }, 300);

    const event = await watchEvent;
    assert(event && event.type === 'files.changed', 'expected files.changed event');

    const filesResponse = await fetch(`http://127.0.0.1:${port}/files`);
    assert(filesResponse.ok, `files failed: HTTP ${filesResponse.status}`);
    const data = await filesResponse.json();
    assert(data.files.includes('docs/new-file.md'), 'new file should appear in /files');

    const attachedResponse = await fetch(`http://127.0.0.1:${port}/workspace-roots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: attachedRoot }),
    });
    assert(attachedResponse.ok, `attach root failed: HTTP ${attachedResponse.status}`);
    const attached = await attachedResponse.json();
    await new Promise(resolve => setTimeout(resolve, 300));

    const attachedWatchEvent = waitForWatchEvent();
    setTimeout(() => {
      fs.writeFileSync(path.join(attachedRoot, 'attached.md'), '# Attached\n', 'utf8');
    }, 300);
    const attachedEvent = await attachedWatchEvent;
    assert(attachedEvent && attachedEvent.type === 'files.changed', 'expected attached-root files.changed event');

    const attachedFilesResponse = await fetch(`http://127.0.0.1:${port}/files`);
    const attachedFiles = await attachedFilesResponse.json();
    assert(attachedFiles.files.includes(`${attached.root.id}/attached.md`), 'attached root file should appear in /files');

    console.log('file watch check passed');
  } finally {
    child.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(attachedRoot, { recursive: true, force: true });
    if (stderr.trim()) process.stderr.write(stderr);
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
