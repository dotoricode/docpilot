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

function postTurn(port, sessionId, message = '테스트 응답을 스트리밍해줘') {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      message,
      outputHints: { contextMode: 'minimal' },
    });
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-fake-agent-'));
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Test\n', 'utf8');
  const changedFile = path.join(workspace, 'agent-output.md');
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(root, 'bridge.js'), '--root', workspace], {
    cwd: root,
    env: {
      ...process.env,
      DOCPILOT_BRIDGE_PORT: String(port),
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_FAKE_AGENT_WRITE_FILE: changedFile,
      DOCPILOT_FAKE_AGENT_ARTIFACT_FILE: 'README.md',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await waitForPing(port);
    const beforeSnapshot = await requestJson(port, 'GET', '/workspace-snapshot');
    const created = await requestJson(port, 'POST', '/sessions', { agent: 'claude', title: 'fake test' });
    const sessionId = created.session.id;
    const events = await postTurn(port, sessionId);
    assert(events.some(event => event.type === 'turn.started'), 'turn.started event missing');
    assert(events.some(event => event.type === 'turn.delta' && event.text.includes('fake claude response')), 'turn.delta fake response missing');
    assert(events.some(event => event.type === 'turn.done'), 'turn.done event missing');
    for (let idx = 0; idx < 6; idx += 1) {
      await postTurn(port, sessionId, `후속 테스트 ${idx}`);
    }
    const summaryEvents = await postTurn(port, sessionId, '요약 적용 여부를 확인해줘');
    const started = summaryEvents.find(event => event.type === 'turn.started');
    assert(started?.promptPackage?.summaryChars > 0, 'turn metadata should report session summary chars');
    assert.strictEqual(started.promptPackage.included.summaryChars, started.promptPackage.summaryChars);
    const detail = await requestJson(port, 'GET', `/sessions/${encodeURIComponent(sessionId)}`);
    assert.strictEqual(detail.messages.filter(message => message.role === 'assistant').length, 8);
    const userMessages = detail.messages.filter(message => message.role === 'user');
    assert(userMessages.every(message => message.outputHints?.contextMode === 'minimal'), 'user turn output hints should be persisted');
    assert(userMessages.every(message => message.promptPackageSummary?.totalPromptChars > 0), 'user prompt package summaries should be persisted');
    assert(detail.messages.filter(message => message.role === 'assistant').every(message => message.promptPackageSummary?.totalPromptChars > 0), 'assistant prompt package summaries should be persisted');
    assert(detail.session.summaryChars > 0, 'session summary should be stored');
    assert(detail.session.summaryMessageCount > 0, 'session summary message count should advance');
    assert(detail.artifacts.length > 0, 'fake artifact should be captured');
    assert(detail.artifacts.every(artifact => artifact.promptPackageSummary?.totalPromptChars > 0), 'artifact prompt package summaries should be persisted');
    assert(detail.artifacts.every(artifact => artifact.promptPackageSummary?.contextMode === 'minimal'), 'artifact prompt package summary should preserve context mode');
    const logs = await requestJson(port, 'GET', `/sessions/${encodeURIComponent(sessionId)}/logs?limit=1000`);
    assert(logs.logs.some(entry => entry.type === 'session.created'), 'session created log missing');
    assert(logs.logs.some(entry => entry.type === 'turn.started' && entry.promptPackage?.summaryChars > 0), 'turn started summary log missing');
    assert(logs.logs.some(entry => entry.type === 'artifact.created' && entry.promptPackageSummary?.totalPromptChars > 0), 'artifact prompt summary log missing');
    assert(logs.logs.some(entry => entry.type === 'turn.assistant' && entry.summaryChars > 0), 'assistant summary log missing');
    assert(fs.existsSync(changedFile), 'fake agent did not create changed file');
    assert(fs.readFileSync(changedFile, 'utf8').includes('Fake Agent Change'));
    const afterSnapshot = await requestJson(port, 'GET', '/workspace-snapshot');
    assert(beforeSnapshot.files.every(file => file.id !== 'agent-output.md'), 'baseline should not include fake output before turn');
    assert(afterSnapshot.files.some(file => file.id === 'agent-output.md' && file.content.includes('Fake Agent Change')), 'snapshot should include fake output after turn');
  } finally {
    proc.kill();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  if (stderr.trim()) process.stderr.write(stderr);
  console.log('fake agent session checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
