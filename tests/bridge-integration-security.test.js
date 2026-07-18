const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const bridgePath = path.join(repoRoot, 'bridge.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function request(port, route, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.rawBody !== undefined
      ? options.rawBody
      : options.body == null ? '' : JSON.stringify(options.body);
    const headers = {
      ...(options.token ? { 'X-DocPilot-Token': options.token } : {}),
      ...(options.origin !== undefined ? { Origin: options.origin } : {}),
      ...(body && !options.chunked ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      } : {}),
      ...(body && options.chunked ? {
        'Content-Type': 'application/json',
      } : {}),
      ...(options.headers || {}),
    };
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method: options.method || 'GET',
      headers,
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = responseBody ? JSON.parse(responseBody) : null; } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: responseBody, json });
      });
    });
    req.on('error', reject);
    if (body && options.chunked) {
      const midpoint = Math.floor(body.length / 2);
      req.write(body.subarray ? body.subarray(0, midpoint) : body.slice(0, midpoint));
      req.end(body.subarray ? body.subarray(midpoint) : body.slice(midpoint));
    } else {
      req.end(body);
    }
  });
}

async function waitForBridge(port, token) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await request(port, '/ping', { token });
      if (response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('bridge did not become ready');
}

function waitForExit(child, timeoutMs = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bridge did not exit')), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test('bridge requires its capability token and confines workspace files', { timeout: 15000 }, async t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-security-root-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-security-state-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-security-outside-'));
  const port = await freePort();
  const token = 'integration-test-capability-token';
  fs.writeFileSync(path.join(workspace, 'safe.md'), 'original', 'utf8');
  fs.writeFileSync(path.join(workspace, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret', 'utf8');
  if (process.platform !== 'win32') fs.symlinkSync(outside, path.join(workspace, 'escape'));

  const child = spawn(process.execPath, [bridgePath, '--root', workspace], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_BRIDGE_PORT: String(port),
      DOCPILOT_BRIDGE_TOKEN: token,
      DOCPILOT_STATE_DIR: stateDir,
      DOCPILOT_FAKE_AGENT: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  t.after(async () => {
    try { child.kill('SIGTERM'); } catch {}
    try { await waitForExit(child); } catch { child.kill('SIGKILL'); }
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  await waitForBridge(port, token).catch(error => {
    throw new Error(`${error.message}: ${stderr}`);
  });

  assert.equal((await request(port, '/ping')).status, 403);
  assert.equal((await request(port, '/ping', { token: 'wrong-token' })).status, 403);
  assert.equal((await request(port, '/ping', { token, headers: { Host: 'attacker.example' } })).status, 403);
  assert.equal((await request(port, '/ping', { token, origin: 'https://attacker.example' })).status, 403);

  const preflight = await request(port, '/file', {
    method: 'OPTIONS',
    origin: 'null',
    headers: { 'Access-Control-Request-Headers': 'x-docpilot-token' },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers['access-control-allow-headers'], /X-DocPilot-Token/i);
  assert.equal((await request(port, '/file', {
    method: 'OPTIONS',
    origin: 'https://attacker.example',
    headers: { 'Access-Control-Request-Headers': 'x-docpilot-token' },
  })).status, 403);

  const malformedSave = await request(port, '/save', {
    method: 'POST',
    token,
    rawBody: '{',
  });
  assert.equal(malformedSave.status, 400);
  assert.equal(fs.readFileSync(path.join(workspace, 'safe.md'), 'utf8'), 'original');
  assert.equal((await request(port, '/file?id=..%2Fsecret.md', { token })).status, 403);

  assert.equal((await request(port, '/workspace-asset?id=pixel.png')).status, 403);
  assert.equal((await request(port, `/workspace-asset?id=pixel.png&token=${encodeURIComponent(token)}`)).status, 200);

  if (process.platform !== 'win32') {
    assert.equal((await request(port, '/file?id=escape%2Fsecret.md', { token })).status, 403);
    const attached = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-security-attached-'));
    fs.symlinkSync(outside, path.join(attached, 'escape'));
    const attachResponse = await request(port, '/workspace-roots', {
      method: 'POST',
      token,
      body: { path: attached },
    });
    assert.equal(attachResponse.status, 200);
    assert.equal((await request(
      port,
      `/file?id=${encodeURIComponent(`${attachResponse.json.root.id}/escape/secret.md`)}`,
      { token },
    )).status, 403);
    fs.rmSync(attached, { recursive: true, force: true });
  }

  const opened = await request(port, '/file?id=safe.md', { token });
  assert.equal(opened.status, 200);
  assert.equal(opened.json.content, 'original');
  assert.match(opened.json.revision, /^[a-f0-9]{64}$/);

  fs.writeFileSync(path.join(workspace, 'safe.md'), 'external edit', 'utf8');
  const conflictingSave = await request(port, '/save', {
    method: 'POST',
    token,
    body: { id: 'safe.md', content: 'stale local edit', expectedRevision: opened.json.revision },
  });
  assert.equal(conflictingSave.status, 409);
  assert.equal(fs.readFileSync(path.join(workspace, 'safe.md'), 'utf8'), 'external edit');

  const projectChat = await request(port, '/project-chat', {
    method: 'POST',
    token,
    body: { instruction: 'Reply briefly', agent: 'claude' },
  });
  assert.equal(projectChat.status, 200);
  assert.match(projectChat.body, /"done":true/);

  const oversized = await request(port, '/save', {
    method: 'POST',
    token,
    headers: { 'Content-Length': String(8 * 1024 * 1024 + 1) },
  });
  assert.equal(oversized.status, 413);

  const chunkedOversized = await request(port, '/save', {
    method: 'POST',
    token,
    chunked: true,
    rawBody: Buffer.alloc(8 * 1024 * 1024 + 1, 0x20),
  });
  assert.equal(chunkedOversized.status, 413, JSON.stringify(chunkedOversized));
  assert.equal(fs.readFileSync(path.join(workspace, 'safe.md'), 'utf8'), 'external edit');
});
