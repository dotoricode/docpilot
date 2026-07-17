const test = require('node:test');
const assert = require('node:assert/strict');

const { TerminalSessionModel } = require('../shared/core/terminal-session-model');

test('terminal frames receive monotonic sequence numbers', () => {
  const model = new TerminalSessionModel({ maxBytes: 1024 });
  assert.deepEqual(model.append('one'), { seq: 1, data: 'one' });
  assert.deepEqual(model.append('two'), { seq: 2, data: 'two' });
  assert.equal(model.lastSeq, 2);
});

test('snapshot is bounded and reports its sequence window', () => {
  const model = new TerminalSessionModel({ maxBytes: 8 });
  model.append('1234');
  model.append('5678');
  model.append('90');

  assert.deepEqual(model.snapshot(), {
    data: '567890',
    fromSeq: 2,
    lastSeq: 3,
  });
});

test('a single oversized frame cannot exceed the retained byte limit', () => {
  const model = new TerminalSessionModel({ maxBytes: 8 });
  const frame = model.append('0123456789abcdef');

  assert.deepEqual(frame, { seq: 1, data: '0123456789abcdef' });
  assert.equal(model.retainedBytes <= model.maxBytes, true);
  assert.equal(Buffer.byteLength(model.snapshot().data) <= model.maxBytes, true);
  assert.deepEqual(model.replayAfter(0), { needsSnapshot: true, frames: [] });
  model.dispose();
});

test('oversized frame truncation does not retain a partial UTF-8 character', () => {
  const model = new TerminalSessionModel({ maxBytes: 4 });
  model.append('가나다');

  assert.equal(model.snapshot().data, '다');
  assert.equal(Buffer.byteLength(model.snapshot().data), 3);
  model.dispose();
});

test('replay requests older than retained history require a snapshot', () => {
  const model = new TerminalSessionModel({ maxBytes: 6 });
  model.append('abcd');
  model.append('efgh');

  assert.deepEqual(model.replayAfter(0), { needsSnapshot: true, frames: [] });
  assert.deepEqual(model.replayAfter(1), {
    needsSnapshot: false,
    frames: [{ seq: 2, data: 'efgh' }],
  });
});

test('screen snapshot serializes terminal state instead of raw control history', async () => {
  const model = new TerminalSessionModel({ cols: 20, rows: 4 });
  model.append('first\r\nsecond');
  model.append('\rreplacement');

  const snapshot = await model.screenSnapshot();
  assert.match(snapshot.data, /first/);
  assert.match(snapshot.data, /replacement/);
  assert.equal(snapshot.data.includes('second'), false);
  assert.equal(snapshot.lastSeq, 2);
  model.dispose();
});

test('disposing immediately after append safely drains queued screen writes', async () => {
  const model = new TerminalSessionModel({ cols: 20, rows: 4 });
  model.append('pending output');

  await model.dispose();
  await assert.doesNotReject(model.screenWrites);
  assert.equal(model.screen, null);
});

test('dispose does not wait for a terminal write callback that never arrives', async () => {
  const model = new TerminalSessionModel({ cols: 20, rows: 4 });
  model.screen.terminal.write = () => {};
  model.append('blocked output');
  await new Promise(resolve => setImmediate(resolve));

  await model.dispose();
  assert.equal(model.screen, null);
});
