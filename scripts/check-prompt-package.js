const assert = require('assert');
const { buildSessionPromptPackage } = require('../prompt-package');

const session = {
  id: 'test-session',
  agent: 'claude',
  title: 'Claude',
  scope: { type: 'file', id: 'docs/test.md' },
  summary: '오래된 세션 요약입니다.',
};

const previousMessages = [
  { role: 'user', text: 'previous user message '.repeat(200) },
  { role: 'assistant', text: 'previous assistant message '.repeat(200) },
];

const attachments = [
  {
    kind: 'selection',
    fileId: 'docs/test.md',
    label: 'docs/test.md',
    source: 'chip',
    text: 'selected context '.repeat(500),
  },
];

function build(contextMode) {
  return buildSessionPromptPackage({
    root: '/tmp/docpilot',
    session,
    previousMessages,
    message: '사용자 입력',
    attachments,
    requiredInstructions: '',
    outputHints: { contextMode },
  }).metadata;
}

const minimal = build('minimal');
assert.strictEqual(minimal.contextMode, 'minimal');
assert.strictEqual(minimal.inputChars, '사용자 입력'.length);
assert(minimal.summaryChars > 0, 'session summary chars should be reported');
assert.strictEqual(minimal.included.summaryChars, minimal.summaryChars);
assert.strictEqual(minimal.included.transcriptMessages, 0);
assert.strictEqual(minimal.included.attachments, 0);

const selection = build('selection');
assert.strictEqual(selection.contextMode, 'selection');
assert(selection.included.attachments > 0);
assert(selection.totalPromptChars > minimal.totalPromptChars);

const conversation = build('conversation');
assert.strictEqual(conversation.contextMode, 'conversation');
assert(conversation.included.transcriptMessages > 0);
assert.strictEqual(conversation.included.attachments, 0);

const full = build('full');
assert.strictEqual(full.contextMode, 'full');
assert(full.included.transcriptMessages > 0);
assert(full.included.attachments > 0);
assert(full.totalPromptChars > selection.totalPromptChars);

console.log('prompt package context policy checks passed');
