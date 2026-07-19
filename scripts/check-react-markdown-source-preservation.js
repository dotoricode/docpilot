const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function waitForEditor(app) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const page = app.windows().find(window => window.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('React editor did not open');
}

async function dismissReleaseNotice(page) {
  const notice = page.locator('.release-notice-overlay');
  if (await notice.isVisible().catch(() => false)) {
    await notice.getByRole('button', { name: '확인' }).click();
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-document-source-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-document-source-user-'));
  const sourcePath = path.join(fixtureRoot, 'README.md');
  const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(sourcePath, '#  Title\n\nKeep  spacing\n');
  fs.writeFileSync(path.join(fixtureRoot, 'unsupported.md'), '# MDX\n\n<Component />\n');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });

  try {
    const start = await app.firstWindow();
    await start.evaluate(() => {
      localStorage.setItem('docpilot:terminal-open', '0');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
    });
    await start.evaluate(root => { window.docpilot.openFolder(root); }, fixtureRoot);
    const page = await waitForEditor(app);
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.waitForSelector('.home-screen');
    await dismissReleaseNotice(page);

    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).click();
    await page.waitForSelector('.document-markdown-content[contenteditable="true"]');
    await page.locator('.document-editor-shell').screenshot({ path: path.join(artifactRoot, 'markdown-document-editor-dark.png'), scale: 'css' });
    assert.deepStrictEqual(
      await page.locator('.editor-mode-toggle button').allTextContents(),
      ['Source', 'Document', 'Agent Copy'],
    );

    const heading = page.locator('.document-markdown-content h1');
    await heading.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' changed');
    const saveButton = page.locator('button.save-button');
    assert.equal(await saveButton.isEnabled(), true, 'Document edit must enable Save');
    const updateClose = page.getByRole('button', { name: '업데이트 안내 닫기' });
    if (await updateClose.isVisible().catch(() => false)) await updateClose.click();
    await saveButton.click();
    await page.waitForFunction(() => !document.querySelector('.dirty-pill'));
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), '#  Title changed\n\nKeep  spacing\n');

    await page.locator('.document-markdown-content p').fill('Keep spacing through menu save');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => !window.isDestroyed())?.webContents.send('menu-command', 'save');
    });
    await page.waitForFunction(() => !document.querySelector('.dirty-pill') && !document.querySelector('.save-button:not(:disabled)'));
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), '#  Title changed\n\nKeep spacing through menu save\n');

    await page.getByRole('button', { name: 'Agent Copy' }).click();
    await page.waitForSelector('.markdown-preview.agent-copy-active h1');
    assert.equal(await page.locator('.document-markdown-content').count(), 0);
    await page.getByRole('button', { name: 'Agent Copy' }).click();
    await page.waitForSelector('.document-markdown-content[contenteditable="true"]');

    await page.locator('.workspace-file-row').filter({ hasText: 'unsupported.md' }).click();
    const dialog = page.getByRole('dialog', { name: 'Document에서 읽기 전용으로 열었습니다' });
    await dialog.waitFor();
    assert.match(await dialog.textContent(), /지원하지 않는 HTML 또는 JSX/);
    await dialog.getByRole('checkbox', { name: '다시 알리지 않음' }).check();
    await dialog.getByRole('button', { name: '계속 보기' }).click();
    await page.waitForSelector('.document-readonly-banner');
    assert.equal(await page.locator('.document-markdown-content').count(), 0);
    assert.match(await page.locator('.document-readonly-banner').textContent(), /Source에서 편집/);
    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).click();
    await page.locator('.workspace-file-row').filter({ hasText: 'unsupported.md' }).click();
    await page.waitForTimeout(300);
    assert.equal(await dialog.count(), 0, 'suppressed read-only modal must not reappear');
    assert.equal(await page.locator('.document-readonly-banner').count(), 1, 'persistent read-only banner must remain');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().then(
  () => console.log('react Markdown Document source-preservation checks passed'),
  error => { console.error(error); process.exitCode = 1; },
);
