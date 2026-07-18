const test = require('node:test');
const assert = require('node:assert/strict');

const { documentCapabilities, documentFormat, getMarkdownVisualEligibility } = require('../shared/core/document-adapters');

test('Markdown exposes source and visual modes', () => {
  assert.equal(documentFormat('docs/README.md'), 'markdown');
  assert.deepEqual(documentCapabilities('docs/README.md').modes, ['source', 'visual']);
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

test('Visual Markdown is gated with a stable, specific reason', () => {
  assert.deepEqual(getMarkdownVisualEligibility('# Safe\n\n- one\n- two'), { editable: true, reason: '' });
  assert.deepEqual(getMarkdownVisualEligibility('# MDX\n\n<Component />'), { editable: false, reason: 'raw-html' });
  assert.deepEqual(getMarkdownVisualEligibility(':::note\ncustom directive\n:::'), { editable: false, reason: 'directive' });
  assert.deepEqual(getMarkdownVisualEligibility('```md\n<Component />\n:::\n```'), { editable: true, reason: '' });
  assert.deepEqual(getMarkdownVisualEligibility('Visit <https://example.com>.'), { editable: true, reason: '' });
});

test('large Markdown falls back to source mode', () => {
  assert.deepEqual(getMarkdownVisualEligibility('a'.repeat(50_001)), { editable: false, reason: 'document-too-large' });
});
