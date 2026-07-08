const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');

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

function postProjectChat(port) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      agent: 'claude',
      instruction: '프로젝트 범위에서 삭제 후보를 검토해줘.',
    });
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: 'POST',
      path: '/project-chat',
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

async function waitForPing(port, deadline = Date.now() + 5000) {
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-project-chat-'));
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Project Chat Wrapper\n', 'utf8');
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(root, 'bridge.js'), '--root', workspace], {
    cwd: root,
    env: {
      ...process.env,
      DOCPILOT_BRIDGE_PORT: String(port),
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_FAKE_AGENT_ARTIFACT_FILE: 'README.md',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await waitForPing(port);
    const events = await postProjectChat(port);
    assert(events.some(event => event.compatibility === 'session-turn'), 'project-chat must identify session-turn compatibility wrapper');
    assert(events.some(event => event.started && event.promptPackage?.contextMode === 'project'), 'project-chat must start a project context session turn');
    const proxiedText = events.filter(event => event.chunk).map(event => event.chunk).join('');
    assert(proxiedText.includes('fake claude response'), 'project-chat must proxy session output chunks');
    const done = events.find(event => event.done);
    assert(done, 'project-chat must emit a legacy done event');
    assert.strictEqual(done.source, 'claude');
    assert(done.session?.summaryChars >= 0, 'done event must include session summary');
    assert(Array.isArray(done.artifacts) && done.artifacts.length > 0, 'project-chat must forward session artifacts');
    assert(done.artifacts.every(artifact => artifact.promptPackageSummary?.contextMode === 'project'), 'forwarded artifacts must include prompt summary');
    const sessions = await requestJson(port, 'GET', '/sessions');
    assert.strictEqual(sessions.sessions.length, 1, 'project-chat should create one project session');
    assert.strictEqual(sessions.sessions[0].scope.type, 'project');
  } finally {
    proc.kill();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  if (stderr.trim()) process.stderr.write(stderr);
  console.log('project-chat wrapper checks passed');
})().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
