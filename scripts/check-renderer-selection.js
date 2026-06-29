const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const plan = fs.readFileSync(path.join(root, 'docs/context-policy-and-migration-plan.md'), 'utf8');
const editorWorkflow = fs.readFileSync(path.join(root, 'scripts/check-react-editor-workflow.js'), 'utf8');
const viteConfig = fs.readFileSync(path.join(root, 'app/vite.config.ts'), 'utf8');

assert(!main.includes('DOCPILOT_LEGACY_RENDERER'), 'main must not keep DOCPILOT_LEGACY_RENDERER rollback flag');
assert(!main.includes("--legacy-renderer"), 'main must not keep --legacy-renderer rollback flag');
assert(main.includes('fs.existsSync(reactRendererPath)'), 'main must verify the React renderer file exists');
assert(main.includes('dialog.showErrorBox'), 'main must show a clear error when the React renderer bundle is missing');
assert(!main.includes("win.loadFile('editor.html'"), 'legacy editor fallback must not remain available');
assert(main.includes('win.loadFile(reactRendererPath'), 'main must load the React renderer directly');
assert(pkg.build.files.includes('dist/renderer/**'), 'packaged app must include React renderer output');
assert(!pkg.build.files.includes('editor.html'), 'packaged app must not include legacy editor.html');
assert(!plan.includes('DOCPILOT_LEGACY_RENDERER=1'), 'migration plan must not document a removed legacy rollback flag');
assert(plan.includes('legacy `editor.html` is no longer loaded or packaged'), 'migration plan must document the React-only renderer checkpoint');
assert(plan.includes('scripts/check-react-editor-workflow.js'), 'migration plan must include React editor workflow E2E');
assert(editorWorkflow.includes('Saved from React CodeMirror'), 'React editor workflow E2E must edit and save through CodeMirror');
assert(editorWorkflow.includes('.dirty-pill'), 'React editor workflow E2E must verify dirty state');
assert(viteConfig.includes("base: './'"), 'Vite renderer must use relative assets for Electron loadFile');

console.log('renderer selection checks passed');
