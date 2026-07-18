const test = require('node:test');
const assert = require('node:assert/strict');

const { reconcileSerializedMarkdown } = require('../shared/core/markdown-source-reconcile');

test('unchanged Visual document preserves exact source bytes', () => {
  const source = '#  Title\r\n\r\nParagraph  \r\n';
  assert.deepEqual(reconcileSerializedMarkdown({
    originalSource: source,
    baseCanonical: '# Title\n\nParagraph',
    edited: '# Title\n\nParagraph',
    roundTrip: value => value,
  }), { ok: true, markdown: source, reason: '' });
});

test('Visual edit patches only the edited region and preserves CRLF', () => {
  const result = reconcileSerializedMarkdown({
    originalSource: '#  Title\r\n\r\nKeep  spacing\r\n',
    baseCanonical: '# Title\n\nKeep spacing',
    edited: '# Changed\n\nKeep spacing',
    roundTrip: () => '# Changed\n\nKeep spacing',
  });
  assert.equal(result.ok, true);
  assert.equal(result.markdown, '#  Changed\r\n\r\nKeep  spacing\r\n');
});

test('failed safety proof keeps source instead of canonical clobbering it', () => {
  const source = '#  Title\n\nKeep  spacing\n';
  assert.deepEqual(reconcileSerializedMarkdown({
    originalSource: source,
    baseCanonical: '# Title\n\nKeep spacing',
    edited: '# Changed\n\nKeep spacing',
    roundTrip: () => '# Wrong',
  }), { ok: false, markdown: source, reason: 'round-trip-mismatch' });
});

test('oversize reconciliation fails closed', () => {
  const source = 'a'.repeat(50_001);
  assert.deepEqual(reconcileSerializedMarkdown({
    originalSource: source,
    baseCanonical: source,
    edited: `${source}b`,
    roundTrip: value => value,
  }), { ok: false, markdown: source, reason: 'document-too-large' });
});
