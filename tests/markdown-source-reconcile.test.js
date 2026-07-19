const test = require('node:test');
const assert = require('node:assert/strict');

const { reconcileSerializedMarkdown } = require('../shared/core/markdown-source-reconcile');

test('unchanged Document preserves exact source bytes', () => {
  const source = '#  Title\r\n\r\nParagraph  \r\n';
  assert.deepEqual(reconcileSerializedMarkdown({
    originalSource: source,
    baseCanonical: '# Title\n\nParagraph',
    edited: '# Title\n\nParagraph',
    roundTrip: value => value,
  }), { ok: true, markdown: source, reason: '' });
});

test('Document edit patches only the edited region and preserves CRLF', () => {
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

test('Document reconciliation ignores only transient terminal editor paragraphs', () => {
  const result = reconcileSerializedMarkdown({
    originalSource: '# Title\n',
    baseCanonical: '# Title',
    edited: '# Changed\n\n  \n\n',
    roundTrip: () => '# Changed',
  });
  assert.deepEqual(result, { ok: true, markdown: '# Changed\n', reason: '' });
});

test('Document reconciliation may prove equivalent Markdown with an identical parsed tree', () => {
  const result = reconcileSerializedMarkdown({
    originalSource: '[Link](https://example.com)\n',
    baseCanonical: '[Link](https://example.com)',
    edited: '[Link](https://example.com)\n![](asset.svg)',
    roundTrip: () => '[Link](https://example.com)\n\n![](asset.svg)',
    equivalent: (left, right) => left.trim().replace(/\n+/g, '\n') === right.trim().replace(/\n+/g, '\n'),
  });
  assert.equal(result.ok, true);
  assert.match(result.markdown, /asset\.svg/);
});

test('Document block append keeps the original EOF newline outside the inserted block separator', () => {
  const edited = '[Link](https://example.com)\n\n![](asset.svg)';
  const result = reconcileSerializedMarkdown({
    originalSource: '[Link](https://example.com)\n',
    baseCanonical: '[Link](https://example.com)',
    edited,
    roundTrip: value => value.replace(/\n$/, ''),
  });
  assert.deepEqual(result, { ok: true, markdown: `${edited}\n`, reason: '' });
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
