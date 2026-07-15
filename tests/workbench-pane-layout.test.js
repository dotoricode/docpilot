const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createWorkbenchLayout,
  movePane,
  parseWorkbenchLayout,
  panePlacement,
  serializeWorkbenchLayout,
} = require('../shared/core/workbench-pane-layout');

test('terminal pane moves to every edge around the document pane', () => {
  const cases = [
    ['left', 'horizontal', ['terminal', 'document']],
    ['right', 'horizontal', ['document', 'terminal']],
    ['top', 'vertical', ['terminal', 'document']],
    ['bottom', 'vertical', ['document', 'terminal']],
  ];

  for (const [edge, orientation, order] of cases) {
    const layout = movePane(createWorkbenchLayout(), 'terminal', 'document', edge);
    assert.equal(layout.orientation, orientation);
    assert.deepEqual(layout.children.map(child => child.id), order);
    assert.equal(panePlacement(layout, 'terminal', 'document'), edge);
  }
});

test('pane layout round trips without losing split ratio or leaf identity', () => {
  const moved = movePane(createWorkbenchLayout({ terminalSizeRatio: 0.32 }), 'terminal', 'document', 'left');
  const restored = parseWorkbenchLayout(serializeWorkbenchLayout(moved));

  assert.deepEqual(restored, moved);
  assert.equal(restored.ratio, 0.32);
});

test('invalid stored layouts fall back to the default workbench', () => {
  assert.deepEqual(parseWorkbenchLayout('{"type":"split","children":[]}'), createWorkbenchLayout());
  assert.deepEqual(parseWorkbenchLayout('not json'), createWorkbenchLayout());
});
