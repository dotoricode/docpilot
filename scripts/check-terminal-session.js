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

function waitForPing(port, deadline = Date.now() + 5000) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const result = await requestJson(port, 'GET', '/ping');
        if (result.ok) { resolve(); return; }
      } catch {}
      if (Date.now() >= deadline) { reject(new Error('bridge did not start')); return; }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function collectTerminalEvents(port, sessionId, stopWhen) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(`http://127.0.0.1:${port}/terminal-sessions/${encodeURIComponent(sessionId)}/stream`, res => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const data = part.split('\n').find(line => line.startsWith('data:'));
          if (!data) continue;
          const event = JSON.parse(data.slice(5).trim());
          events.push(event);
          if (stopWhen(events, event)) {
            req.destroy();
            resolve(events);
            return;
          }
        }
      });
      res.on('end', () => resolve(events));
    });
    req.on('error', err => {
      if (events.length) resolve(events);
      else reject(err);
    });
    setTimeout(() => {
      req.destroy();
      resolve(events);
    }, 5000);
  });
}

(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-terminal-'));
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(repoRoot, 'bridge.js'), '--root', workspace], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_BRIDGE_PORT: String(port),
      DOCPILOT_FAKE_AGENT: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await waitForPing(port);
    const created = await requestJson(port, 'POST', '/terminal-sessions', { title: 'Terminal 1' });
    assert.strictEqual(created.session.agent, undefined, 'generic terminal must not expose an agent binding');
    assert.strictEqual(created.session.title, 'Terminal 1');
    assert(created.session.shell, 'terminal should expose its login shell');
    assert.strictEqual(created.session.status, 'running');
    assert.strictEqual(created.session.mode, 'fake-interactive');
    await requestJson(port, 'POST', `/terminal-sessions/${encodeURIComponent(created.session.id)}/resize`, { cols: 90, rows: 24 });

    const eventsPromise = collectTerminalEvents(port, created.session.id, events =>
      events.some(event => event.type === 'terminal.frame' && String(event.data || '').includes('fake shell> hello terminal')),
    );
    await requestJson(port, 'POST', `/terminal-sessions/${encodeURIComponent(created.session.id)}/input`, { data: 'hello terminal\n' });
    const events = await eventsPromise;
    const terminalOutput = events.map(event => event.type === 'terminal.snapshot' ? event.snapshot?.data : event.data).filter(Boolean).join('');
    assert(events.some(event => event.type === 'terminal.ready'), 'terminal ready event missing');
    assert(terminalOutput.includes('fake shell interactive ready'), 'initial terminal output missing');
    assert(terminalOutput.includes('fake shell> hello terminal'), 'terminal input response missing');

    const listed = await requestJson(port, 'GET', '/terminal-sessions');
    assert(listed.sessions.some(session => session.id === created.session.id), 'terminal session should be listed');
    const runtime = await requestJson(port, 'GET', '/agent-runtime');
    assert.strictEqual(runtime.runtime.ptyAvailable, true, 'node-pty should be available after dependency installation');
    assert.strictEqual(runtime.runtime.executionMode, 'node-pty');
    const stopped = await requestJson(port, 'DELETE', `/terminal-sessions/${encodeURIComponent(created.session.id)}`);
    assert.strictEqual(stopped.ok, true);
  } finally {
    proc.kill();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  if (stderr.trim()) process.stderr.write(stderr);
  console.log('terminal session checks passed');
})().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
