const test = require('node:test');
const assert = require('node:assert/strict');

const { documentCapabilities, documentFormat, markdownRichSafety } = require('../shared/core/document-adapters');

test('Markdown exposes lossless source plus rich and preview modes', () => {
  assert.equal(documentFormat('docs/README.md'), 'markdown');
  assert.deepEqual(documentCapabilities('docs/README.md').modes, ['source', 'rich', 'preview']);
});

test('AsciiDoc and JSON expose format-specific capabilities', () => {
  assert.deepEqual(documentCapabilities('manual.adoc'), {
    format: 'asciidoc',
    modes: ['source', 'preview'],
    outline: true,
    formatDocument: false,
    validate: false,
  });
  assert.deepEqual(documentCapabilities('schema.json'), {
    format: 'json',
    modes: ['source', 'tree'],
    outline: false,
    formatDocument: true,
    validate: true,
  });
});

test('Source-focused formats do not invent preview support', () => {
  assert.deepEqual(documentCapabilities('src/index.ts').modes, ['source']);
  assert.deepEqual(documentCapabilities('notes.txt').modes, ['source']);
});

test('rich Markdown is gated when source cannot round trip safely', () => {
  assert.deepEqual(markdownRichSafety('# Safe\n\n- one\n- two'), { safe: true, reason: '' });
  assert.deepEqual(markdownRichSafety('# MDX\n\n<Component />'), { safe: false, reason: 'unsupported-syntax' });
  assert.deepEqual(markdownRichSafety(':::note\ncustom directive\n:::'), { safe: false, reason: 'unsupported-syntax' });
});

test('large Markdown falls back to source mode', () => {
  assert.deepEqual(markdownRichSafety('a'.repeat(300_001)), { safe: false, reason: 'document-too-large' });
});
