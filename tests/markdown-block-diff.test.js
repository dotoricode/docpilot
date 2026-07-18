const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_LCS_MATRIX_CELLS,
  sequenceDiffRows,
} = require('../shared/core/markdown-block-diff');

test('large block diffs avoid a quadratic LCS matrix without dropping text', () => {
  const count = Math.ceil(Math.sqrt(MAX_LCS_MATRIX_CELLS)) + 10;
  const oldItems = Array.from({ length: count }, (_, index) => `old-${index}`);
  const newItems = Array.from({ length: count }, (_, index) => `new-${index}`);
  oldItems[0] = newItems[0] = 'shared-prefix';
  oldItems[count - 1] = newItems[count - 1] = 'shared-suffix';

  const rows = sequenceDiffRows(oldItems, newItems);
  assert.equal(rows[0].type, 'same');
  assert.equal(rows.at(-1).type, 'same');
  assert.deepEqual(rows.filter(row => row.type !== 'add').map(row => row.oldBlock), oldItems);
  assert.deepEqual(rows.filter(row => row.type !== 'del').map(row => row.newBlock), newItems);
});
