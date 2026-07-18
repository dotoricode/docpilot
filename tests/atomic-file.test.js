const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { writeJsonAtomic } = require('../shared/core/atomic-file');

test('private JSON writes are complete and owner-only', t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-atomic-'));
  const filePath = path.join(sandbox, 'state', 'settings.json');
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  writeJsonAtomic(filePath, { value: 1 });
  writeJsonAtomic(filePath, { value: 2 });

  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { value: 2 });
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(filePath)).mode & 0o777, 0o700);
  }
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['settings.json']);
});
