const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function requestJson(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? '' : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: route,
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
    req.end(payload);
  });
}

function postTurn(port, sessionId, message) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ message, outputHints: { contextMode: 'minimal' } });
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: 'POST',
      path: `/sessions/${encodeURIComponent(sessionId)}/turn`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let buffer = '';
      const events = [];
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const data = part.split('\n').find(line => line.startsWith('data:'));
          if (!data) continue;
          events.push(JSON.parse(data.slice(5).trim()));
        }
      });
      res.on('end', () => resolve(events));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function waitForPing(port, deadline = Date.now() + 8000) {
  while (Date.now() < deadline) {
    try {
      const result = await requestJson(port, 'GET', '/ping');
      if (result.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('bridge did not start');
}

(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-real-claude-'));
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Real Claude bridge check\n', 'utf8');
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(repoRoot, 'bridge.js'), '--root', workspace], {
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_BRIDGE_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await waitForPing(port);
    const runtime = await requestJson(port, 'GET', '/agent-runtime');
    assert.strictEqual(runtime.runtime.claudeCommand, 'claude', 'default claude command should be reported');
    const created = await requestJson(port, 'POST', '/sessions', { agent: 'claude', title: 'real claude check' });
    const events = await postTurn(port, created.session.id, 'Reply exactly: DOCPILOT_OK');
    assert(events.some(event => event.type === 'turn.started'), 'turn.started event missing');
    assert(events.some(event => event.type === 'turn.done'), 'turn.done event missing');
    assert(!events.some(event => event.type === 'turn.error'), `turn.error event emitted: ${JSON.stringify(events)}`);
    const streamedText = events.filter(event => event.type === 'turn.delta').map(event => event.text || '').join('');
    assert(streamedText.includes('DOCPILOT_OK'), `real claude response missing marker: ${streamedText}`);
    const detail = await requestJson(port, 'GET', `/sessions/${encodeURIComponent(created.session.id)}`);
    assert(detail.messages.some(message => message.role === 'assistant' && message.text.includes('DOCPILOT_OK')), 'assistant message was not persisted');
  } finally {
    proc.kill();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  if (stderr.trim()) process.stderr.write(stderr);
  console.log('real claude session checks passed');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
