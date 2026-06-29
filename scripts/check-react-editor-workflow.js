const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function waitForReactEditorWindow(app) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    for (const win of app.windows()) {
      const url = win.url();
      if (url.includes('dist/renderer/index.html') || url.endsWith('/index.html')) return win;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor window did not open. Windows: ${app.windows().map(win => win.url()).join(', ')}`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-editor-workflow-'));
  const filePath = path.join(fixtureRoot, 'draft.md');
  fs.writeFileSync(filePath, '# Draft\n\nInitial body.\n', 'utf8');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_FAKE_AGENT: '1',
    },
  });

  try {
    const start = await app.firstWindow();
    await start.waitForLoadState('domcontentloaded');
    await start.evaluate(root => {
      window.docpilot.openFolder(root);
      return true;
    }, fixtureRoot);

    const editor = await waitForReactEditorWindow(app);
    await editor.waitForSelector('.workspace-sidebar');
    await editor.waitForSelector('.file-row');
    await editor.locator('.file-row').filter({ hasText: 'draft.md' }).first().click();
    await editor.locator('.editor-mode-toggle button').filter({ hasText: '편집' }).click();
    await editor.waitForSelector('.cm-editor');

    await editor.locator('.cm-content').click();
    await editor.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await editor.keyboard.type('# Draft Updated\n\nSaved from React CodeMirror.\n');

    await editor.waitForSelector('.dirty-pill');
    const dirtyText = await editor.locator('.dirty-pill').innerText();
    assert(dirtyText.includes('수정됨'), 'dirty state should be visible after editor change');

    await editor.locator('.save-button').click();
    await editor.waitForFunction(() => !document.querySelector('.dirty-pill'));

    const diskContent = fs.readFileSync(filePath, 'utf8');
    assert(diskContent.includes('Saved from React CodeMirror.'), 'saved file should contain editor changes');

    await editor.locator('.editor-mode-toggle button').filter({ hasText: '프리뷰' }).click();
    await editor.waitForSelector('.markdown-preview h1');
    const previewTitle = await editor.locator('.markdown-preview h1').innerText();
    assert.strictEqual(previewTitle.trim(), 'Draft Updated');

    console.log('react editor workflow checks passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
