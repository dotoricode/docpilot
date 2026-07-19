const test = require('node:test');
const assert = require('node:assert/strict');
const { locateMarkdownDocumentSelection } = require('../shared/core/markdown-document-selection');

test('Document selection exposes stable file, line, block, text, and editor offsets', () => {
  const source = '# Title\n\nRepeated text\n\nRepeated text\n';
  assert.deepEqual(locateMarkdownDocumentSelection({
    fileId: 'guide.md',
    source,
    text: 'Repeated text',
    blockType: 'paragraph',
    editorFrom: 29,
    editorTo: 42,
    documentSize: 43,
  }), {
    fileId: 'guide.md',
    text: 'Repeated text',
    from: 24,
    to: 37,
    lineStart: 5,
    lineEnd: 5,
    blockType: 'paragraph',
    editorFrom: 29,
    editorTo: 42,
  });
});

test('Document selection fails closed when selected text cannot be mapped to source', () => {
  assert.equal(locateMarkdownDocumentSelection({
    fileId: 'guide.md', source: '# Title', text: 'missing', blockType: 'heading', editorFrom: 1, editorTo: 8, documentSize: 8,
  }), null);
});
