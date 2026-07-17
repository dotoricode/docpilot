const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { movePathToRecoverableTrash, movePathToRecoverableTrashAsync } = require('../shared/core/recoverable-trash');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-trash-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('recoverable trash uses an atomic rename on the same volume', t => {
  const root = sandbox(t);
  const source = path.join(root, 'workspace', 'note.md');
  const target = path.join(root, 'state', 'trash', 'note.md');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'keep me', 'utf8');

  assert.deepEqual(movePathToRecoverableTrash(source, target), { crossDevice: false });
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep me');
});

test('recoverable trash safely falls back to copy and remove on EXDEV', t => {
  const root = sandbox(t);
  const source = path.join(root, 'workspace', 'docs');
  const target = path.join(root, 'state', 'trash', 'docs');
  fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(source, 'nested', 'note.md'), 'cross-volume', 'utf8');
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, 'outside', 'utf8');
  if (process.platform !== 'win32') fs.symlinkSync(outside, path.join(source, 'nested', 'outside-link'));
  let renameCalls = 0;
  const renameSync = (from, to) => {
    renameCalls += 1;
    if (renameCalls === 1) {
      const error = new Error('cross-device link not permitted');
      error.code = 'EXDEV';
      throw error;
    }
    fs.renameSync(from, to);
  };

  assert.deepEqual(movePathToRecoverableTrash(source, target, { renameSync }), { crossDevice: true });
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(path.join(target, 'nested', 'note.md'), 'utf8'), 'cross-volume');
  if (process.platform !== 'win32') {
    assert.equal(fs.lstatSync(path.join(target, 'nested', 'outside-link')).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
  }
  assert.equal(fs.readdirSync(path.dirname(target)).some(name => name.endsWith('.copying')), false);
});

test('async recoverable trash keeps cross-volume copies off the event loop path', async t => {
  const root = sandbox(t);
  const source = path.join(root, 'workspace', 'note.md');
  const target = path.join(root, 'state', 'trash', 'note.md');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'async cross-volume', 'utf8');
  let renameCalls = 0;
  const rename = async (from, to) => {
    renameCalls += 1;
    if (renameCalls === 1) {
      const error = new Error('cross-device link not permitted');
      error.code = 'EXDEV';
      throw error;
    }
    await fs.promises.rename(from, to);
  };

  assert.deepEqual(await movePathToRecoverableTrashAsync(source, target, { rename }), { crossDevice: true });
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'async cross-volume');
});
