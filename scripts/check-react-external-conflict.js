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
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-external-conflict-'));
  const filePath = path.join(fixtureRoot, 'conflict.md');
  fs.writeFileSync(filePath, '# Original\n\nDisk baseline.\n', 'utf8');

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
    await editor.locator('.file-row').filter({ hasText: 'conflict.md' }).first().click();
    await editor.locator('.editor-mode-toggle button').filter({ hasText: '편집' }).click();
    await editor.waitForSelector('.cm-editor');

    await editor.locator('.cm-content').click();
    await editor.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await editor.keyboard.type('# User Draft\n\nKeep this unsaved editor text.\n');
    await editor.waitForSelector('.dirty-pill');

    fs.writeFileSync(filePath, '# External Change\n\nWritten outside DocPilot.\n', 'utf8');

    await editor.waitForSelector('.conflict-pill', { timeout: 8000 });
    const conflictText = await editor.locator('.conflict-pill').innerText();
    assert(conflictText.includes('external-conflict'), `expected external conflict, got ${conflictText}`);

    await editor.locator('.editor-mode-toggle button').filter({ hasText: '프리뷰' }).click();
    await editor.waitForSelector('.markdown-preview h1');
    const previewTitleBeforeAccept = await editor.locator('.markdown-preview h1').innerText();
    assert.strictEqual(previewTitleBeforeAccept.trim(), 'User Draft', 'dirty editor content must not be overwritten by external disk write');

    await editor.waitForSelector('.file-review-card', { timeout: 8000 });
    const changedText = await editor.locator('.changed-files-panel').innerText();
    assert(changedText.includes('conflict.md'), 'changed files panel should show externally changed file');
    assert(changedText.includes('디스크 변경'), 'review card should label external disk change');

    await editor.locator('.file-review-card .accept-button').first().click();
    await editor.waitForFunction(() => !document.querySelector('.file-review-card'));
    await editor.waitForFunction(() => !document.querySelector('.dirty-pill'));

    const diskContent = fs.readFileSync(filePath, 'utf8');
    assert(diskContent.includes('External Change'), 'accepted external change should remain on disk');
    const previewTitleAfterAccept = await editor.locator('.markdown-preview h1').innerText();
    assert.strictEqual(previewTitleAfterAccept.trim(), 'External Change');

    console.log('react external conflict checks passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
