const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const draftPath = path.join(root, 'prototypes/manual-v2/content/v2.0.0.md');
const guidePath = path.join(root, 'prototypes/manual-v2/content/demo-production-guide.md');
const draft = fs.readFileSync(draftPath, 'utf8');
const guide = fs.readFileSync(guidePath, 'utf8');

const workflowHeadings = draft.match(/^## \d+\. /gm) || [];
assert.ok(workflowHeadings.length >= 5 && workflowHeadings.length <= 7, `expected 5–7 workflow groups, found ${workflowHeadings.length}`);

for (const claim of [
  'Markdown: Source, Rich, Preview, Outline',
  'AsciiDoc: Source, Preview, Outline',
  'JSON: Source, Tree, Format, Validate',
  '왼쪽·오른쪽·위·아래 배치',
  '기본 로그인 셸',
  '`⌘⇧F`',
  '## 검증 근거',
]) {
  assert.ok(draft.includes(claim), `v2 content claim missing: ${claim}`);
}

for (const evidence of [
  'shared/core/document-adapters.js',
  'shared/core/workbench-pane-layout.js',
  'shared/core/terminal-session-model.js',
  'app/src/screens/App.tsx',
]) {
  assert.ok(fs.existsSync(path.join(root, evidence)), `evidence file missing: ${evidence}`);
}

for (const scenario of ['workbench', 'split', 'terminal', 'diff', 'search']) {
  assert.match(guide, new RegExp(`\\| ${scenario} \\|`), `demo scenario missing: ${scenario}`);
}

console.log('manual v2 content contract: passed');
