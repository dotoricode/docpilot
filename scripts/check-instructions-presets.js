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

function hasNamedSet(response, field, name) {
  return Array.isArray(response[field]) && response[field].some(item => item.name === name);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-instructions-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-home-'));
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Instructions\n', 'utf8');
  const port = 18500 + Math.floor(Math.random() * 1000);
  const proc = spawn(process.execPath, [path.join(repoRoot, 'bridge.js'), '--root', workspace], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_BRIDGE_PORT: String(port),
      DOCPILOT_ALLOW_UNAUTHENTICATED: '1',
      HOME: home,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForBridge(proc);
    const created = await requestJson(port, 'POST', '/instructions', {
      title: 'Tone',
      body: 'Use concise Korean copy.',
      active: true,
    });
    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.instruction.active, true);
    assert(Array.isArray(created.projectSets), 'create response must include projectSets');
    assert(Array.isArray(created.globalSets), 'create response must include globalSets');

    const id = created.instruction.id;
    const projectSaved = await requestJson(port, 'POST', '/instruction-sets/save', {
      name: 'Project Preset',
      scope: 'project',
      instructionIds: [id],
    });
    assert(hasNamedSet(projectSaved, 'projectSets', 'Project Preset'), 'project preset should be saved');

    const globalSaved = await requestJson(port, 'POST', '/instruction-sets/save', {
      name: 'Global Preset',
      scope: 'global',
      instructionIds: [id],
    });
    assert(hasNamedSet(globalSaved, 'projectSets', 'Project Preset'), 'global save response should keep project presets');
    assert(hasNamedSet(globalSaved, 'globalSets', 'Global Preset'), 'global preset should be saved');

    const toggled = await requestJson(port, 'POST', '/instructions', {
      ...created.instruction,
      active: false,
    });
    assert.strictEqual(toggled.ok, true);
    assert.strictEqual(toggled.instruction.active, false);
    assert.strictEqual(toggled.activeSetId || '', '', 'OFF toggle should clear the currently applied preset marker');
    assert(hasNamedSet(toggled, 'projectSets', 'Project Preset'), 'OFF toggle response should keep project presets visible');
    assert(hasNamedSet(toggled, 'globalSets', 'Global Preset'), 'OFF toggle response should keep global presets visible');

    const reloaded = await requestJson(port, 'GET', '/instructions');
    assert.strictEqual(reloaded.activeSetId || '', '', 'reloaded state should not keep a stale active preset marker');
    assert(hasNamedSet(reloaded, 'projectSets', 'Project Preset'), 'project preset should persist after reload');
    assert(hasNamedSet(reloaded, 'globalSets', 'Global Preset'), 'global preset should persist after reload');

    const deleted = await requestJson(port, 'POST', '/instructions/delete', { id });
    assert.strictEqual(deleted.ok, true);
    const cleanedSet = deleted.projectSets.find(item => item.name === 'Project Preset');
    assert(cleanedSet, 'project preset row should remain after instruction delete');
    assert.deepStrictEqual(cleanedSet.instructionIds || [], [], 'deleted instruction id should be removed from project presets');
    console.log('instructions preset checks passed');
  } finally {
    proc.kill('SIGTERM');
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
