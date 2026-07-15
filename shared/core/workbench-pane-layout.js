const PANE_EDGES = new Set(['left', 'right', 'top', 'bottom']);
const LEAF_IDS = new Set(['document', 'terminal']);

function createLeaf(id) {
  return { type: 'leaf', id, kind: id };
}

function createWorkbenchLayout(options = {}) {
  const position = PANE_EDGES.has(options.terminalPosition) ? options.terminalPosition : 'bottom';
  const terminalSizeRatio = clampRatio(options.terminalSizeRatio ?? 0.3);
  return splitForPosition(position, terminalSizeRatio);
}

function movePane(layout, paneId, targetId, edge) {
  const safe = isWorkbenchLayout(layout) ? layout : createWorkbenchLayout();
  if (!LEAF_IDS.has(paneId) || !LEAF_IDS.has(targetId) || paneId === targetId || !PANE_EDGES.has(edge)) {
    return safe;
  }
  const terminalRatio = paneSizeRatio(safe, 'terminal');
  const terminalPosition = paneId === 'terminal' ? edge : oppositeEdge(edge);
  return splitForPosition(terminalPosition, terminalRatio);
}

function splitForPosition(position, terminalSizeRatio) {
  const terminalFirst = position === 'left' || position === 'top';
  return {
    type: 'split',
    id: 'workbench-root',
    orientation: position === 'left' || position === 'right' ? 'horizontal' : 'vertical',
    ratio: terminalFirst ? terminalSizeRatio : 1 - terminalSizeRatio,
    children: terminalFirst
      ? [createLeaf('terminal'), createLeaf('document')]
      : [createLeaf('document'), createLeaf('terminal')],
  };
}

function panePlacement(layout, paneId, targetId) {
  if (!isWorkbenchLayout(layout) || paneId === targetId) return null;
  const index = layout.children.findIndex(child => child.id === paneId);
  const targetIndex = layout.children.findIndex(child => child.id === targetId);
  if (index < 0 || targetIndex < 0) return null;
  if (layout.orientation === 'horizontal') return index < targetIndex ? 'left' : 'right';
  return index < targetIndex ? 'top' : 'bottom';
}

function paneSizeRatio(layout, paneId) {
  if (!isWorkbenchLayout(layout)) return 0.3;
  const index = layout.children.findIndex(child => child.id === paneId);
  if (index === 0) return clampRatio(layout.ratio);
  if (index === 1) return clampRatio(1 - layout.ratio);
  return 0.3;
}

function resizePane(layout, paneId, sizeRatio) {
  if (!isWorkbenchLayout(layout)) return createWorkbenchLayout();
  const ratio = clampRatio(sizeRatio);
  const index = layout.children.findIndex(child => child.id === paneId);
  if (index < 0) return layout;
  return { ...layout, ratio: index === 0 ? ratio : 1 - ratio };
}

function serializeWorkbenchLayout(layout) {
  return JSON.stringify(isWorkbenchLayout(layout) ? layout : createWorkbenchLayout());
}

function parseWorkbenchLayout(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return isWorkbenchLayout(parsed) ? parsed : createWorkbenchLayout();
  } catch {
    return createWorkbenchLayout();
  }
}

function isWorkbenchLayout(value) {
  if (!value || value.type !== 'split' || value.id !== 'workbench-root') return false;
  if (!['horizontal', 'vertical'].includes(value.orientation)) return false;
  if (!Number.isFinite(value.ratio) || value.ratio < 0.1 || value.ratio > 0.9) return false;
  if (!Array.isArray(value.children) || value.children.length !== 2) return false;
  const ids = value.children.map(child => child?.type === 'leaf' ? child.id : '').sort();
  return ids[0] === 'document' && ids[1] === 'terminal';
}

function oppositeEdge(edge) {
  return { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[edge] || 'bottom';
}

function clampRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.3;
  return Math.round(Math.min(0.8, Math.max(0.2, number)) * 1000) / 1000;
}

module.exports = {
  createWorkbenchLayout,
  isWorkbenchLayout,
  movePane,
  panePlacement,
  paneSizeRatio,
  parseWorkbenchLayout,
  resizePane,
  serializeWorkbenchLayout,
};
