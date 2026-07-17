const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { fileRevision, writeExistingWorkspaceFileAtomic } = require('../shared/core/workspace-file');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-save-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('workspace save atomically replaces a regular file and preserves its mode', t => {
  const root = sandbox(t);
  const filePath = path.join(root, 'note.md');
  fs.writeFileSync(filePath, 'before', { encoding: 'utf8', mode: 0o640 });

  const revision = writeExistingWorkspaceFileAtomic(filePath, 'after', fileRevision('before'));
  assert.equal(revision, fileRevision('after'));
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'after');
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(root), ['note.md']);
});

test('workspace save rejects a disk change made after the temp file is flushed', t => {
  const root = sandbox(t);
  const filePath = path.join(root, 'note.md');
  fs.writeFileSync(filePath, 'before', 'utf8');

  assert.throws(
    () => writeExistingWorkspaceFileAtomic(filePath, 'local edit', fileRevision('before'), {
      beforeCommit: () => fs.writeFileSync(filePath, 'external edit', 'utf8'),
    }),
    error => error?.code === 'SAVE_CONFLICT' && error.revision === fileRevision('external edit'),
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'external edit');
  assert.deepEqual(fs.readdirSync(root), ['note.md']);
});
