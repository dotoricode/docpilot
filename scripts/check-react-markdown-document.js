const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

async function dismissUpdateCard(page) {
  const close = page.getByRole('button', { name: '업데이트 안내 닫기' });
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-document-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-document-user-'));
  const sourcePath = path.join(fixtureRoot, 'README.md');
  const shortcutsPath = path.join(fixtureRoot, 'shortcuts.md');
  const mediaPath = path.join(fixtureRoot, 'media.md');
  const advancedPath = path.join(fixtureRoot, 'advanced.md');
  const mathPath = path.join(fixtureRoot, 'math.md');
  const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(sourcePath, '# Existing title\n\nEditable paragraph\n');
  fs.writeFileSync(shortcutsPath, '');
  fs.writeFileSync(mediaPath, 'Link target\n');
  fs.writeFileSync(advancedPath, '');
  fs.writeFileSync(mathPath, '');
  fs.writeFileSync(path.join(fixtureRoot, 'asset.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#5794f2"/></svg>');

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
    const document = page.locator('.document-markdown-content[contenteditable="true"]');
    await document.waitFor();
    assert.deepEqual(
      await page.locator('.editor-mode-toggle button').allTextContents(),
      ['Source', 'Document', 'Agent Copy'],
      'Markdown must expose Source / Document and Agent Copy',
    );
    await page.locator('.theme-toggle button').filter({ hasText: 'Dark' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await dismissUpdateCard(page);
    await page.locator('.document-editor-shell').screenshot({ path: path.join(artifactRoot, 'markdown-document-direct-dark.png'), scale: 'css' });
    await page.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await dismissUpdateCard(page);
    await page.locator('.document-editor-shell').screenshot({ path: path.join(artifactRoot, 'markdown-document-direct-light.png'), scale: 'css' });

    const paragraph = document.locator('p').filter({ hasText: 'Editable paragraph' });
    assert.equal(await paragraph.evaluate(node => getComputedStyle(node).cursor), 'text', 'editable Document blocks must use an I-beam cursor');
    await paragraph.click();
    assert.equal(await page.locator('.preview-inline-editor').count(), 0, 'Document click must never open the Source line overlay');
    await paragraph.evaluate(node => {
      const editor = node.closest('[contenteditable="true"]');
      const range = window.document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (editor instanceof HTMLElement) editor.focus();
    });

    await page.keyboard.press('Enter');
    await page.keyboard.type('## ');
    await page.keyboard.type('Heading two');
    assert.equal(
      await document.locator('h2').last().textContent(),
      'Heading two',
      `\`## \` must create a level-two heading: ${await document.evaluate(node => node.innerHTML)}`,
    );

    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- [ ] ');
    await page.keyboard.type('Task item');
    await page.waitForTimeout(200);
    const taskItems = document.locator('ul[data-type="taskList"] li[data-checked]');
    assert.equal(
      await taskItems.count(),
      1,
      `\`- [ ] \` must create a task item; actual DOM: ${await document.innerHTML()}`,
    );
    assert.equal(await taskItems.last().innerText(), 'Task item', '`- [ ] ` must create a task item');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await page.waitForTimeout(400);
    assert.equal(
      await document.count(),
      1,
      `Document must remain editable after task serialization; state: ${JSON.stringify(await page.evaluate(() => ({
        reason: document.querySelector('.editor-workspace')?.getAttribute('data-document-safety-reason'),
        banner: document.querySelector('.document-readonly-banner')?.textContent,
      })))}`,
    );

    await page.locator('summary[aria-label="더 많은 블록"]').click();
    await page.getByRole('button', { name: '표 삽입' }).click();
    await document.locator('table').waitFor();
    await page.getByRole('button', { name: '열 추가' }).waitFor();
    await page.getByRole('button', { name: '행 추가' }).waitFor();
    await page.getByRole('button', { name: '표 삭제' }).waitFor();

    await dismissUpdateCard(page);
    await page.locator('button.save-button').click();
    await page.waitForFunction(() => !document.querySelector('.dirty-pill'));
    const saved = fs.readFileSync(sourcePath, 'utf8');
    assert.match(saved, /^# Existing title/m);
    assert.match(saved, /^## Heading two/m);
    assert.match(saved, /^- \[ \] Task item/m);
    assert.match(saved, /^\|/m, 'inserted table must serialize to Markdown');

    await page.getByRole('button', { name: 'Agent Copy' }).click();
    await page.waitForSelector('.markdown-preview.agent-copy-active');
    assert.equal(await page.locator('.document-markdown-content').count(), 0, 'Agent Copy must replace Document editing with the read-only copy surface');
    await page.getByRole('button', { name: 'Agent Copy' }).click();

    await page.locator('.workspace-file-row').filter({ hasText: 'shortcuts.md' }).click();
    await page.locator('.file-tab.active[title="shortcuts.md"]').waitFor();
    await page.waitForFunction(() => (document.querySelector('.document-markdown-content')?.textContent || '').trim() === '');
    await document.waitFor();
    await document.click();
    for (let level = 1; level <= 6; level += 1) {
      await page.keyboard.type(`${'#'.repeat(level)} `);
      await page.keyboard.type(`Heading ${level}`);
      assert.equal(await document.locator(`h${level}`).last().textContent(), `Heading ${level}`, `level ${level} heading shortcut must render directly`);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('- ');
    await page.keyboard.type('Bullet item');
    assert.equal(await document.locator('ul:not([data-type="taskList"]) li').last().innerText(), 'Bullet item');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1. ');
    await page.keyboard.type('Ordered item');
    assert.equal(await document.locator('ol li').last().innerText(), 'Ordered item');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('[ ] ');
    await page.keyboard.type('Task shorthand');
    assert.equal(await document.locator('ul[data-type="taskList"] li[data-checked]').last().innerText(), 'Task shorthand');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('> ');
    await page.keyboard.type('Quoted text');
    assert.equal(await document.locator('blockquote').last().innerText(), 'Quoted text');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/table');
    await page.getByRole('listbox', { name: '블록 추가' }).waitFor();
    await page.keyboard.press('Enter');
    const shortcutTable = document.locator('table').last();
    await shortcutTable.waitFor();
    await shortcutTable.locator('th,td').first().click();
    await page.getByRole('button', { name: '열 추가' }).click();
    await page.getByRole('button', { name: '행 추가' }).click();
    assert.equal(await shortcutTable.locator('tr').count(), 4, 'table toolbar must add a row');
    assert.equal(await shortcutTable.locator('tr').first().locator('th,td').count(), 4, 'table toolbar must add a column');
    await page.waitForTimeout(400);
    assert.equal(await document.count(), 1, 'all Markdown input rules must remain source-safe after commit');
    await dismissUpdateCard(page);
    await page.locator('button.save-button').click();
    await page.waitForFunction(() => !document.querySelector('.dirty-pill'));
    const shortcutsSaved = fs.readFileSync(shortcutsPath, 'utf8');
    for (let level = 1; level <= 6; level += 1) assert.match(shortcutsSaved, new RegExp(`^${'#'.repeat(level)} Heading ${level}$`, 'm'));
    assert.match(shortcutsSaved, /^- Bullet item$/m);
    assert.match(shortcutsSaved, /^1\. Ordered item$/m);
    assert.match(shortcutsSaved, /^- \[ \] Task shorthand$/m);
    assert.match(shortcutsSaved, /^> Quoted text$/m);
    assert.match(shortcutsSaved, /^\|/m);

    await page.locator('.workspace-file-row').filter({ hasText: 'media.md' }).click();
    await page.locator('.file-tab.active[title="media.md"]').waitFor();
    await page.waitForFunction(() => (document.querySelector('.document-markdown-content')?.textContent || '').trim() === 'Link target');
    await document.waitFor();
    await document.locator('p').click();
    await page.keyboard.press('Meta+A');
    await page.getByRole('button', { name: '링크' }).click();
    const linkInput = page.getByLabel('링크 URL');
    await linkInput.fill('https://example.com/docs');
    await page.getByRole('button', { name: '적용' }).click();
    assert.equal(await document.locator('a').getAttribute('href'), 'https://example.com/docs');
    await document.locator('p').evaluate(node => {
      const editor = node.closest('[contenteditable="true"]');
      const range = window.document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (editor instanceof HTMLElement) editor.focus();
    });
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '이미지' }).click();
    const imageInput = page.getByLabel('이미지 경로 또는 URL');
    await imageInput.fill('asset.svg');
    await page.getByRole('button', { name: '적용' }).click();
    await document.locator('.document-image-node img').waitFor();
    await page.waitForTimeout(400);
    assert.equal(
      await document.count(),
      1,
      `link and image edits must remain source-safe after commit: ${JSON.stringify(await page.evaluate(() => ({
        reason: document.querySelector('.editor-workspace')?.getAttribute('data-document-safety-reason'),
      })))}`,
    );
    await dismissUpdateCard(page);
    await page.locator('button.save-button').click();
    await page.waitForFunction(() => !document.querySelector('.dirty-pill'));
    const mediaSaved = fs.readFileSync(mediaPath, 'utf8');
    assert.match(mediaSaved, /\[Link target\]\(https:\/\/example\.com\/docs\)/);
    assert.match(mediaSaved, /!\[\]\(asset\.svg\)/);

    await page.locator('.workspace-file-row').filter({ hasText: 'advanced.md' }).click();
    await page.locator('.file-tab.active[title="advanced.md"]').waitFor();
    await page.waitForFunction(() => (document.querySelector('.document-markdown-content')?.textContent || '').trim() === '');
    await document.waitFor();
    await document.click();
    await page.keyboard.type('/mermaid');
    await page.getByRole('listbox', { name: '블록 추가' }).waitFor();
    await page.keyboard.press('Enter');
    assert.match(await document.locator('pre code').innerText(), /graph TD/);
    await page.waitForTimeout(400);
    await dismissUpdateCard(page);
    await page.locator('button.save-button').click();
    await page.waitForFunction(() => !document.querySelector('.dirty-pill'));
    assert.match(fs.readFileSync(advancedPath, 'utf8'), /^```mermaid/m);

    await page.locator('.workspace-file-row').filter({ hasText: 'math.md' }).click();
    await page.locator('.file-tab.active[title="math.md"]').waitFor();
    await page.waitForFunction(() => (document.querySelector('.document-markdown-content')?.textContent || '').trim() === '');
    await document.waitFor();
    await document.click();
    await page.locator('summary[aria-label="더 많은 블록"]').click();
    await page.getByRole('button', { name: '수식 블록' }).click();
    await document.locator('.tiptap-mathematics-render').waitFor();
    await page.waitForTimeout(400);
    assert.equal(await document.count(), 1, 'math blocks must remain source-safe after commit');
    await dismissUpdateCard(page);
    await page.locator('button.save-button').click();
    await page.waitForFunction(() => !document.querySelector('.dirty-pill'));
    assert.match(fs.readFileSync(mathPath, 'utf8'), /^\$\$\nx\n\$\$$/m);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().then(
  () => console.log('react Markdown Document checks passed'),
  error => { console.error(error); process.exitCode = 1; },
);
