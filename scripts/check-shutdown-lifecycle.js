const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { fork, spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const bridgePath = path.join(repoRoot, 'bridge.js');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
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
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : undefined,
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(data ? JSON.parse(data) : {}); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function waitForPing(port, deadline = Date.now() + 5000) {
  while (Date.now() < deadline) {
    try {
      const ping = await requestJson(port, 'GET', '/ping');
      if (ping.ok) return ping;
    } catch {}
    await delay(50);
  }
  throw new Error(`bridge on port ${port} did not start`);
}

async function waitForPortClosed(port, deadline = Date.now() + 2500) {
  while (Date.now() < deadline) {
    try { await requestJson(port, 'GET', '/ping'); }
    catch { return; }
    await delay(50);
  }
  throw new Error(`bridge port ${port} remained open after shutdown`);
}

function waitForExit(child, timeoutMs = 2500) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`process ${child.pid} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
    };
    child.once('exit', onExit);
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
    await delay(50);
  }
  throw new Error(`process group ${pid} survived bridge shutdown`);
}

function forceStopGroup(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
    else process.kill(pid, 'SIGKILL');
  } catch {}
}

function streamTurn(port, sessionId) {
  const events = [];
  let request;
  let resolveStarted;
  let rejectStarted;
  const started = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const done = new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      message: 'shutdown lifecycle test '.repeat(40),
      outputHints: { contextMode: 'minimal' },
    });
    request = http.request({
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
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find(item => item.startsWith('data:'));
          if (!line) continue;
          const event = JSON.parse(line.slice(5).trim());
          events.push(event);
          if (event.type === 'turn.started') resolveStarted(event);
        }
      });
      res.on('end', () => resolve(events));
      res.on('error', reject);
    });
    request.on('error', error => {
      rejectStarted(error);
      reject(error);
    });
    request.end(payload);
  });
  return { events, started, done, close: () => request?.destroy() };
}

function openProjectWatch(port) {
  let request;
  let response;
  let resolveReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    request = http.get(`http://127.0.0.1:${port}/watch`, res => {
      response = res;
      res.setEncoding('utf8');
      res.once('data', resolveReady);
    });
    request.on('error', reject);
  });
  const closed = new Promise(resolve => {
    const attach = () => {
      if (!response) { setTimeout(attach, 10); return; }
      response.once('end', resolve);
      response.once('close', resolve);
      response.once('error', resolve);
    };
    attach();
  });
  return { ready, closed, close: () => request?.destroy() };
}

function collectProcess(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`helper timed out:\n${stderr}`));
    }, timeoutMs);
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`helper exited ${code}:\n${stderr}`));
    });
  });
}

async function checkForkChannelDoesNotRetainParent() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-disconnect-'));
  const port = await freePort();
  const helperSource = `
    const http = require('http');
    const { fork } = require('child_process');
    const child = fork(process.env.BRIDGE_PATH, ['--root', process.env.WORKSPACE], {
      env: { ...process.env, DOCPILOT_BRIDGE_PORT: process.env.BRIDGE_PORT, DOCPILOT_ALLOW_UNAUTHENTICATED: '1', DOCPILOT_FAKE_AGENT: '1' },
      detached: true,
      stdio: 'ignore',
    });
    child.channel?.unref?.();
    child.unref();
    const deadline = Date.now() + 4000;
    const poll = () => {
      const req = http.get('http://127.0.0.1:' + process.env.BRIDGE_PORT + '/ping', res => {
        res.resume();
        res.on('end', () => console.log(JSON.stringify({ pid: child.pid })));
      });
      req.on('error', () => {
        if (Date.now() >= deadline) throw new Error('bridge did not start');
        setTimeout(poll, 30);
      });
    };
    poll();
  `;
  let pid = null;
  try {
    const helper = spawn(process.execPath, ['-e', helperSource], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BRIDGE_PATH: bridgePath,
        BRIDGE_PORT: String(port),
        WORKSPACE: workspace,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = await collectProcess(helper);
    const record = JSON.parse(result.stdout.trim().split('\n').pop());
    pid = record.pid;
    await waitForPortClosed(port);
    await waitForProcessGroupGone(pid);
  } finally {
    forceStopGroup(pid);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function checkGracefulResourceCleanup() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-shutdown-'));
  const terminalPidFile = path.join(workspace, '.terminal-pid');
  const agentPidFile = path.join(workspace, '.agent-pid');
  const agentChildPidFile = path.join(workspace, '.agent-child-pid');
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Shutdown test\n', 'utf8');
  const port = await freePort();
  const child = fork(bridgePath, ['--root', workspace], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_BRIDGE_PORT: String(port),
      DOCPILOT_ALLOW_UNAUTHENTICATED: '1',
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_FAKE_AGENT_DELAY_MS: '80',
      DOCPILOT_FAKE_AGENT_CHUNK_SIZE: '1',
      DOCPILOT_TEST_TERMINAL_SEPARATE_GROUP: '1',
      DOCPILOT_FAKE_TERMINAL_PID_FILE: terminalPidFile,
      DOCPILOT_FAKE_AGENT_IGNORE_SIGTERM: '1',
      DOCPILOT_FAKE_AGENT_PID_FILE: agentPidFile,
      DOCPILOT_FAKE_AGENT_CHILD_PID_FILE: agentChildPidFile,
    },
    detached: true,
    stdio: 'ignore',
  });
  child.channel?.unref?.();
  child.unref();
  const reportedTerminalGroups = new Map();
  const reportedAgentGroups = new Map();
  child.on('message', message => {
    const id = typeof message?.id === 'string' ? message.id : '';
    const pid = Number(message?.pid);
    if (!id || !Number.isInteger(pid) || pid <= 0) return;
    if (message?.type === 'terminal-group-started') reportedTerminalGroups.set(id, pid);
    if (message?.type === 'terminal-group-stopped' && reportedTerminalGroups.get(id) === pid) {
      reportedTerminalGroups.delete(id);
    }
    if (message?.type === 'agent-group-started') reportedAgentGroups.set(id, pid);
    if (message?.type === 'agent-group-stopped' && reportedAgentGroups.get(id) === pid) {
      reportedAgentGroups.delete(id);
    }
  });
  let turn;
  let watch;
  let terminalPid = null;
  let agentPid = null;
  let agentChildPid = null;
  try {
    await waitForPing(port);
    await requestJson(port, 'POST', '/adoc-convert', { source: '= Shutdown\n\nWorker test.', id: 'test.adoc' });
    await requestJson(port, 'POST', '/terminal-sessions', { title: 'Shutdown terminal' });
    const terminalPidDeadline = Date.now() + 2000;
    while (!fs.existsSync(terminalPidFile) && Date.now() < terminalPidDeadline) await delay(20);
    terminalPid = Number(fs.readFileSync(terminalPidFile, 'utf8'));
    assert(Number.isInteger(terminalPid) && terminalPid > 0, 'separate terminal process did not start');
    const terminalReportDeadline = Date.now() + 1000;
    while (![...reportedTerminalGroups.values()].includes(terminalPid) && Date.now() < terminalReportDeadline) await delay(20);
    assert([...reportedTerminalGroups.values()].includes(terminalPid), 'terminal process group was not reported to the parent');
    const created = await requestJson(port, 'POST', '/sessions', { agent: 'claude', title: 'Shutdown agent' });
    turn = streamTurn(port, created.session.id);
    await turn.started;
    await assert.rejects(
      requestJson(port, 'POST', `/sessions/${encodeURIComponent(created.session.id)}/turn`, {
        message: 'a concurrent turn must be rejected',
        outputHints: { contextMode: 'minimal' },
      }),
      /HTTP 409:.*turn already running/,
      'a second turn must not replace the active agent process',
    );
    const agentPidDeadline = Date.now() + 2000;
    while ((!fs.existsSync(agentPidFile) || !fs.existsSync(agentChildPidFile)) && Date.now() < agentPidDeadline) await delay(20);
    agentPid = Number(fs.readFileSync(agentPidFile, 'utf8'));
    agentChildPid = Number(fs.readFileSync(agentChildPidFile, 'utf8'));
    assert(Number.isInteger(agentPid) && agentPid > 0, 'separate agent process did not start');
    assert(Number.isInteger(agentChildPid) && agentChildPid > 0, 'agent descendant did not start');
    const agentReportDeadline = Date.now() + 1000;
    while (![...reportedAgentGroups.values()].includes(agentPid) && Date.now() < agentReportDeadline) await delay(20);
    assert([...reportedAgentGroups.values()].includes(agentPid), 'agent process group was not reported to the parent');
    watch = openProjectWatch(port);
    await watch.ready;
    await delay(120);

    const startedAt = Date.now();
    child.kill('SIGTERM');
    const exited = await waitForExit(child);
    const elapsed = Date.now() - startedAt;
    assert.strictEqual(exited.code, 0, `bridge should exit cleanly, got signal ${exited.signal}`);
    assert(elapsed < 2000, `bridge shutdown took too long: ${elapsed}ms`);

    const turnEvents = await turn.done;
    assert(turnEvents.some(event => event.type === 'turn.stopped'), 'active agent turn was not stopped gracefully');
    await Promise.race([
      watch.closed,
      delay(1000).then(() => { throw new Error('project watch client did not close'); }),
    ]);
    await waitForPortClosed(port);
    await waitForProcessGroupGone(child.pid);
    await waitForProcessGroupGone(terminalPid);
    await waitForProcessGroupGone(agentPid);
  } finally {
    turn?.close();
    watch?.close();
    forceStopGroup(child.pid);
    forceStopGroup(terminalPid);
    forceStopGroup(agentPid);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function checkLifecycleWiring() {
  const main = fs.readFileSync(path.join(repoRoot, 'main.js'), 'utf8');
  const bridge = fs.readFileSync(bridgePath, 'utf8');
  assert(main.includes('child.channel?.unref?.()'), 'fork IPC channel must be unreferenced');
  const stopStart = main.indexOf('function stopOwnedBridge');
  const stopEnd = main.indexOf('\nfunction stopAllOwnedBridges', stopStart);
  const stopSource = main.slice(stopStart, stopEnd);
  assert(
    stopSource.indexOf("signalOwnedBridge(proc, 'SIGTERM')") < stopSource.indexOf('proc.disconnect()'),
    'bridge IPC must remain connected until after graceful SIGTERM',
  );
  assert(main.includes("message?.type === 'terminal-group-started'"), 'main process must track separate terminal groups');
  assert(main.includes("message?.type === 'agent-group-started'"), 'main process must track separate agent groups');
  assert(main.includes("process.kill(-proc.pid, signal)"), 'POSIX bridge process group must be terminated');
  assert(main.includes("app.on('before-quit'"), 'before-quit cleanup missing');
  assert(main.includes("app.on('will-quit'"), 'will-quit cleanup missing');
  assert(main.includes("powerMonitor.on('shutdown'"), 'system shutdown cleanup missing');
  assert(main.includes('stopDevWatchers()'), 'development watcher cleanup missing');
  assert(bridge.includes("process.once('SIGTERM'"), 'bridge SIGTERM handler missing');
  assert(bridge.includes("process.once('SIGINT'"), 'bridge SIGINT handler missing');
  assert(bridge.includes('parentDisconnectRequested'), 'bridge parent disconnect handling missing');
  assert(bridge.includes('server.close(finish)'), 'HTTP server shutdown missing');
  assert(bridge.includes('stopActiveAgentTurns'), 'agent cleanup missing');
  assert(bridge.includes('MAX_ACTIVE_AGENT_TURNS'), 'agent concurrency cap missing');
  assert(bridge.includes('agentProcesses.has(sessionId)'), 'same-session turn guard missing');
  assert(bridge.includes("notifyAgentGroup(proc, 'agent-group-started')"), 'agent process-group reporting missing');
  assert(bridge.includes('stopAllTerminalSessions'), 'terminal cleanup missing');
  assert(bridge.includes('bridgeShuttingDown = true'), 'shutdown must reject late resource creation');
  assert(bridge.includes("process.kill(-pid, signal)"), 'PTY process-group cleanup missing');
  assert(bridge.includes('stopAsciidocWorker'), 'worker cleanup missing');
}

(async () => {
  checkLifecycleWiring();
  await checkForkChannelDoesNotRetainParent();
  await checkGracefulResourceCleanup();
  console.log('shutdown lifecycle checks passed');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
