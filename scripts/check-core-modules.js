const assert = require('assert');
const {
  normalizeContextMode,
  budgetsForContextMode,
  contextModeLabel,
  chooseContextMode,
} = require('../shared/core/context-policy');
const {
  createFileBuffer,
  updateEditorContent,
  markSaved,
  applyDiskChange,
  canAutoApplyDiskChange,
} = require('../shared/core/file-buffer');
const {
  markdownPreviewBlocks,
  markdownLineSig,
  markdownBlockDiffRows,
} = require('../shared/core/markdown-block-diff');
const {
  createSessionState,
  upsertSession,
  startSessionTurn,
  applySessionEvent,
  deleteSessionState,
} = require('../shared/core/session-state');
const { AgentProcessManager } = require('../shared/core/agent-process-manager');

assert.strictEqual(normalizeContextMode('bad'), 'minimal');
assert.strictEqual(contextModeLabel('selection'), '선택 문맥');
assert.strictEqual(chooseContextMode({ message: '안녕', attachments: [] }), 'minimal');
assert.strictEqual(chooseContextMode({ message: '안녕', attachments: [{ text: 'x' }] }), 'selection');
assert.strictEqual(chooseContextMode({ message: '위에서 말한 것 이어서 해줘', attachments: [] }), 'conversation');
assert.strictEqual(chooseContextMode({ explicitMode: 'document' }), 'document');
assert.strictEqual(budgetsForContextMode('minimal').attachments, 0);
assert(budgetsForContextMode('selection').attachments > 0);

const clean = createFileBuffer({ path: 'docs/a.md', content: 'a' });
assert.strictEqual(clean.conflictState, 'clean');
assert.strictEqual(clean.dirtyByUser, false);

const dirty = updateEditorContent(clean, 'b');
assert.strictEqual(dirty.dirtyByUser, true);

const conflict = applyDiskChange(dirty, 'c', 'agent');
assert.strictEqual(conflict.conflictState, 'agent-conflict');
assert.strictEqual(canAutoApplyDiskChange(conflict), false);

const external = applyDiskChange(clean, 'disk', 'external');
assert.strictEqual(external.editorContent, 'disk');
assert.strictEqual(canAutoApplyDiskChange(external), true);

const noopDiskChange = applyDiskChange(clean, 'a', 'external');
assert.strictEqual(noopDiskChange, clean);
assert.strictEqual(noopDiskChange.conflictState, 'clean');

const saved = markSaved(dirty, 'b');
assert.strictEqual(saved.dirtyByUser, false);
assert.strictEqual(saved.conflictState, 'clean');

const markdown = `# Title

Paragraph one.

| 항목 | 값 |
|---|---|
| 색상 | 파란색 |

- a
- b
`;
const blocks = markdownPreviewBlocks(markdown);
assert.strictEqual(blocks.length, 4);
assert.strictEqual(markdownLineSig('| a | b |'), 'table');

const diffRows = markdownBlockDiffRows(markdown, markdown.replace('파란색', '빨간색'));
assert(diffRows.some(row => row.type === 'change'));

let sessionState = createSessionState();
sessionState = upsertSession(sessionState, { id: 's1', agent: 'claude', status: 'idle' });
assert.strictEqual(sessionState.sessions.length, 1);
sessionState = startSessionTurn(sessionState, 's1', { role: 'user', text: 'hello' }, 1000);
assert.strictEqual(sessionState.sessions[0].status, 'running');
assert.strictEqual(sessionState.sessionMessages.s1.length, 1);
sessionState = applySessionEvent(sessionState, 's1', { type: 'turn.delta', text: 'hi' });
assert.strictEqual(sessionState.sessionStreams.s1, 'hi');
sessionState = applySessionEvent(sessionState, 's1', { type: 'artifact.created', artifact: { id: 'a1' } });
assert.strictEqual(sessionState.sessionArtifacts.s1.length, 1);
sessionState = applySessionEvent(sessionState, 's1', { type: 'turn.done', message: { role: 'assistant', text: 'done' }, session: { id: 's1', status: 'idle' } });
assert.strictEqual(sessionState.sessions[0].status, 'idle');
assert.strictEqual(sessionState.sessionStreams.s1, '');
assert.strictEqual(sessionState.sessionTurnStartedAt.s1, undefined);
sessionState = deleteSessionState(sessionState, 's1');
assert.strictEqual(sessionState.sessions.length, 0);
assert.strictEqual(sessionState.sessionMessages.s1, undefined);

const processManager = new AgentProcessManager();
let killed = false;
processManager.register('s1', { turnId: 't1', proc: { kill: () => { killed = true; } } });
assert.strictEqual(processManager.has('s1'), true);
assert.deepStrictEqual(processManager.list(), [{ sessionId: 's1', turnId: 't1' }]);
processManager.stop('s1');
assert.strictEqual(killed, true);
assert.strictEqual(processManager.has('s1'), false);

console.log('core module checks passed');
