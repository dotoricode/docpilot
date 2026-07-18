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

function processGroupExists(pid) {
  if (process.platform === 'win32') return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessGroupGone(pid, deadline = Date.now() + 2500) {
  if (process.platform === 'win32') return;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`terminal process group ${pid} survived session close`);
}

(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-terminal-'));
  const terminalPidFile = path.join(workspace, '.terminal-pid');
  const terminalChildPidFile = path.join(workspace, '.terminal-child-pid');
  const port = await freePort();
  let terminalPid = null;
  let terminalChildPid = null;
  const proc = spawn(process.execPath, [path.join(repoRoot, 'bridge.js'), '--root', workspace], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_BRIDGE_PORT: String(port),
      DOCPILOT_ALLOW_UNAUTHENTICATED: '1',
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_FAKE_TERMINAL_PID_FILE: terminalPidFile,
      DOCPILOT_FAKE_TERMINAL_CHILD_PID_FILE: terminalChildPidFile,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await waitForPing(port);
    const created = await requestJson(port, 'POST', '/terminal-sessions', { title: 'Terminal 1', shellId: 'zsh' });
    assert.strictEqual(created.session.agent, undefined, 'generic terminal must not expose an agent binding');
    assert.strictEqual(created.session.title, 'Terminal 1');
    assert.strictEqual(created.session.shellId, 'zsh', 'terminal must preserve the selected embedded shell id');
    assert(created.session.shell, 'terminal should expose its login shell');
    assert.strictEqual(created.session.status, 'running');
    assert.strictEqual(created.session.mode, 'fake-interactive');
    const pidDeadline = Date.now() + 1500;
    while ((!fs.existsSync(terminalPidFile) || !fs.existsSync(terminalChildPidFile)) && Date.now() < pidDeadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    terminalPid = Number(fs.readFileSync(terminalPidFile, 'utf8'));
    terminalChildPid = Number(fs.readFileSync(terminalChildPidFile, 'utf8'));
    assert(Number.isInteger(terminalPid) && terminalPid > 0, 'terminal PID missing');
    assert(Number.isInteger(terminalChildPid) && terminalChildPid > 0, 'terminal child PID missing');
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
    assert.strictEqual(typeof runtime.runtime.ptyAvailable, 'boolean');
    assert.strictEqual(
      runtime.runtime.executionMode,
      runtime.runtime.ptyAvailable ? 'node-pty' : 'stream',
      'runtime mode must reflect whether the native node-pty binding can actually load',
    );
    const stopped = await requestJson(port, 'DELETE', `/terminal-sessions/${encodeURIComponent(created.session.id)}`);
    assert.strictEqual(stopped.ok, true);
    await waitForProcessGroupGone(terminalPid);
  } finally {
    proc.kill();
    if (process.platform !== 'win32' && Number.isInteger(terminalPid) && terminalPid > 0) {
      try { process.kill(-terminalPid, 'SIGKILL'); } catch {}
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  if (stderr.trim()) process.stderr.write(stderr);
  console.log('terminal session checks passed');
})().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
