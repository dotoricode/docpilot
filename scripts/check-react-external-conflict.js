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
  const cleanFilePath = path.join(fixtureRoot, 'clean.md');
  fs.writeFileSync(filePath, '# Original\n\nDisk baseline.\n', 'utf8');
  fs.writeFileSync(cleanFilePath, '# Clean Original\n\nDisk baseline.\n', 'utf8');

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
    await editor.waitForSelector('.bridge-status.connected', { timeout: 15000 });
    await editor.waitForSelector('.workspace-sidebar', { timeout: 15000 });
    const releaseNotice = editor.locator('.release-notice-overlay');
    if (await releaseNotice.count()) {
      await releaseNotice.locator('button').filter({ hasText: '확인' }).click();
    }
    await editor.waitForSelector('.file-row', { timeout: 15000 });
    await editor.locator('.file-row').filter({ hasText: 'conflict.md' }).first().click({ timeout: 15000 });
    await editor.locator('.editor-mode-toggle button').filter({ hasText: 'Source' }).click();
    await editor.waitForSelector('.cm-editor');

    await editor.locator('.cm-content').click();
    await editor.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await editor.keyboard.type('# User Draft\n\nKeep this unsaved editor text.\n');
    await editor.waitForSelector('.dirty-pill');

    fs.writeFileSync(filePath, '# External Change\n\nWritten outside DocPilot.\n', 'utf8');

    await editor.waitForSelector('.conflict-pill', { timeout: 8000 });
    const conflictText = await editor.locator('.conflict-pill').innerText();
    assert(conflictText.includes('외부 변경 충돌'), `expected external conflict, got ${conflictText}`);

    await editor.locator('.editor-mode-toggle button').filter({ hasText: 'Document' }).click();
    await editor.waitForSelector('.markdown-preview h1');
    const previewTitleBeforeAccept = await editor.locator('.markdown-preview h1').innerText();
    assert.strictEqual(previewTitleBeforeAccept.trim(), 'User Draft', 'dirty editor content must not be overwritten by external disk write');

    const diskContent = fs.readFileSync(filePath, 'utf8');
    assert(diskContent.includes('External Change'), 'external change should remain on disk while dirty editor content is protected');

    editor.once('dialog', dialog => dialog.accept());
    await editor.locator('.editor-conflict-bar button').filter({ hasText: '내 버전으로 덮어쓰기' }).click();
    await editor.waitForSelector('.conflict-pill', { state: 'detached', timeout: 8000 });
    await editor.waitForSelector('.dirty-pill', { state: 'detached', timeout: 8000 });
    assert(
      fs.readFileSync(filePath, 'utf8').includes('Keep this unsaved editor text.'),
      'confirmed local overwrite should persist the protected user draft',
    );

    await editor.locator('.file-row').filter({ hasText: 'clean.md' }).first().click({ timeout: 15000 });
    await editor.waitForFunction(() => {
      const heading = document.querySelector('.markdown-preview h1');
      return heading?.textContent?.trim() === 'Clean Original';
    }, null, { timeout: 8000 });
    const cleanTitleBefore = await editor.locator('.markdown-preview h1').innerText();
    assert.strictEqual(cleanTitleBefore.trim(), 'Clean Original');

    fs.writeFileSync(cleanFilePath, '# Clean External Change\n\nWritten outside DocPilot.\n', 'utf8');

    await editor.waitForFunction(() => {
      const heading = document.querySelector('.markdown-preview h1');
      return heading?.textContent?.trim() === 'Clean External Change';
    }, null, { timeout: 8000 });
    const cleanConflictText = await editor.locator('.conflict-pill').innerText();
    assert(cleanConflictText.includes('외부 변경'), `expected clean external-change marker, got ${cleanConflictText}`);

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
