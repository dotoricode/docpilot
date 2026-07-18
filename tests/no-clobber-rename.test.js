const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { renamePathNoClobber } = require('../shared/core/no-clobber-rename');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-rename-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('regular file rename never replaces a concurrently existing target', t => {
  const root = sandbox(t);
  const source = path.join(root, 'source.md');
  const target = path.join(root, 'target.md');
  fs.writeFileSync(source, 'source', 'utf8');
  fs.writeFileSync(target, 'target', 'utf8');

  assert.throws(() => renamePathNoClobber(source, target), error => error?.code === 'EEXIST');
  assert.equal(fs.readFileSync(source, 'utf8'), 'source');
  assert.equal(fs.readFileSync(target, 'utf8'), 'target');
});

test('regular file rename preserves content and removes the old name', t => {
  const root = sandbox(t);
  const source = path.join(root, 'source.md');
  const target = path.join(root, 'target.md');
  fs.writeFileSync(source, 'source', 'utf8');

  renamePathNoClobber(source, target);
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'source');
});
