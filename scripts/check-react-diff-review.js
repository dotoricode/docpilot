const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app/src/screens/App.tsx'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'app/src/features/editor/EditorPane.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'app/src/workbench-final.css'), 'utf8');

assert(app.includes('reviewDiff'), 'App must keep document review state');
assert(!app.includes('ChangedFilesPanel'), 'App must not restore the legacy agent-specific review panel');
assert(editor.includes('readWorkspaceFileBase'), 'Diff review must load a stable file baseline');
assert(editor.includes('DiffChangesRail'), 'Editor must render the Orca-style Changes rail');
assert(editor.includes('Accept Changes'), 'Changes rail must expose acceptance');
assert(editor.includes('Return to Edit'), 'Changes rail must return to editing');
assert(editor.includes('scrollDiffChangeIntoView'), 'Change cards must jump within the document scroller');
assert(editor.includes('data-diff-index'), 'Rendered diff blocks must expose jump targets');
assert(editor.includes('preview-diff-token ${token.code'), 'Preview diff must retain inline change tokens');
assert(styles.includes('.diff-review-shell .markdown-preview.diff-preview-mode .preview-diff-page'), 'Review layout must keep diff content out of the hidden header row');
assert(styles.includes('.preview-diff-block.add'), 'Review styles must distinguish additions');
assert(styles.includes('.preview-diff-block.del'), 'Review styles must distinguish deletions');

console.log('react diff review checks passed');
