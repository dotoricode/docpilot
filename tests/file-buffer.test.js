const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyDiskChange,
  applyPeerSaveResult,
  applySaveResult,
  createFileBuffer,
  updateEditorContent,
} = require('../shared/core/file-buffer');

test('disk revisions track the version an edit was based on', () => {
  const opened = createFileBuffer({ path: 'a.md', content: 'old', revision: 'rev-1' });
  const edited = updateEditorContent(opened, 'local edit');
  const conflicted = applyDiskChange(edited, 'external edit', 'external', 'rev-2');

  assert.equal(conflicted.lastKnownDiskRevision, 'rev-2');
  assert.equal(conflicted.lastSavedRevision, 'rev-1');
  assert.equal(conflicted.conflictState, 'external-conflict');
});

test('save result marks the matching unchanged buffer clean', () => {
  const edited = updateEditorContent(createFileBuffer({ path: 'a.md', content: 'old' }), 'saved');
  const result = applySaveResult(edited, 'a.md', 'saved');

  assert.equal(result.editorContent, 'saved');
  assert.equal(result.lastSavedContent, 'saved');
  assert.equal(result.dirtyByUser, false);
});

test('save result advances the persisted revision', () => {
  const edited = updateEditorContent(createFileBuffer({ path: 'a.md', content: 'old', revision: 'rev-1' }), 'saved');
  const result = applySaveResult(edited, 'a.md', 'saved', 'rev-2');

  assert.equal(result.lastKnownDiskRevision, 'rev-2');
  assert.equal(result.lastSavedRevision, 'rev-2');
});

test('save result refreshes another clean view of the same file', () => {
  const duplicateView = createFileBuffer({ path: 'guide.md', content: 'before', revision: 'rev-1' });
  const saved = applyPeerSaveResult(duplicateView, 'guide.md', 'saved elsewhere', 'rev-2');

  assert.equal(saved.editorContent, 'saved elsewhere');
  assert.equal(saved.lastSavedContent, 'saved elsewhere');
  assert.equal(saved.lastSavedRevision, 'rev-2');
  assert.equal(saved.dirtyByUser, false);
  assert.equal(saved.conflictState, 'clean');
});

test('save result preserves edits made while the save was in flight', () => {
  const editedAgain = updateEditorContent(
    updateEditorContent(createFileBuffer({ path: 'a.md', content: 'old' }), 'submitted'),
    'newer local edit',
  );
  const result = applySaveResult(editedAgain, 'a.md', 'submitted');

  assert.equal(result.editorContent, 'newer local edit');
  assert.equal(result.lastSavedContent, 'submitted');
  assert.equal(result.lastKnownDiskContent, 'submitted');
  assert.equal(result.dirtyByUser, true);
});

test('save result preserves a revert made while the save was in flight', () => {
  const original = createFileBuffer({ path: 'a.md', content: 'old' });
  const submitted = updateEditorContent(original, 'submitted');
  const reverted = updateEditorContent(submitted, 'old');
  const result = applySaveResult(reverted, 'a.md', 'submitted');

  assert.equal(reverted.dirtyByUser, false);
  assert.equal(result.editorContent, 'old');
  assert.equal(result.lastSavedContent, 'submitted');
  assert.equal(result.dirtyByUser, true);
});

test('save result never marks a different active file as saved', () => {
  const differentFile = updateEditorContent(createFileBuffer({ path: 'b.md', content: 'old' }), 'unsaved b');
  const result = applySaveResult(differentFile, 'a.md', 'saved a');

  assert.equal(result, differentFile);
  assert.equal(result.dirtyByUser, true);
});
