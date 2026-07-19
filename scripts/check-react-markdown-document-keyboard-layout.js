#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');

async function waitForEditor(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = app.windows().find(window => window.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('React editor window did not open');
}

async function dismissOverlays(page) {
  const release = page.locator('.release-notice-overlay');
  if (await release.isVisible().catch(() => false)) await release.getByRole('button', { name: '확인' }).click();
  const updateClose = page.getByRole('button', { name: '업데이트 안내 닫기' });
  if (await updateClose.isVisible().catch(() => false)) await updateClose.click();
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-document-keyboard-layout-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-document-keyboard-layout-user-'));
  const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n');
  fs.writeFileSync(path.join(workspace, 'layout.md'), `# Layout\n\n${paragraphs}\n`, 'utf8');
  fs.writeFileSync(path.join(workspace, 'keyboard.md'), '', 'utf8');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });

  try {
    const start = await app.firstWindow();
    await start.evaluate(root => {
      localStorage.setItem('docpilot:terminal-open', '1');
      localStorage.setItem('docpilot:terminal-orientation', 'vertical');
      localStorage.setItem('docpilot:terminal-size', '260');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
      void window.docpilot.openFolder(root);
    }, workspace);

    const page = await waitForEditor(app);
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.waitForSelector('.home-screen');
    await dismissOverlays(page);
    await page.locator('.workspace-file-row').filter({ hasText: 'layout.md' }).click();
    await page.waitForSelector('.terminal-pane');
    const document = page.locator('.document-markdown-content[contenteditable="true"]');
    await document.waitFor();
    const shell = page.locator('.document-editor-shell');
    await shell.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await document.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    const slashMenu = page.getByRole('listbox', { name: '블록 추가' });
    await slashMenu.waitFor();

    const geometry = await page.evaluate(() => {
      const menu = document.querySelector('.document-slash-menu');
      const editorShell = document.querySelector('.document-editor-shell');
      const terminal = document.querySelector('.terminal-pane');
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const caret = range?.getBoundingClientRect();
      if (!(menu instanceof HTMLElement) || !(editorShell instanceof HTMLElement) || !(terminal instanceof HTMLElement) || !caret) {
        throw new Error('slash-menu geometry unavailable');
      }
      const menuRect = menu.getBoundingClientRect();
      const shellRect = editorShell.getBoundingClientRect();
      const terminalRect = terminal.getBoundingClientRect();
      return {
        menuTop: Math.round(menuRect.top),
        menuBottom: Math.round(menuRect.bottom),
        shellBottom: Math.round(shellRect.bottom),
        terminalTop: Math.round(terminalRect.top),
        caretTop: Math.round(caret.top),
      };
    });
    const visibleBottom = Math.min(geometry.shellBottom, geometry.terminalTop);
    assert.ok(geometry.menuBottom <= visibleBottom - 8, `slash menu must stay above the terminal: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.menuTop < geometry.caretTop, `bottom-edge slash menu must open upward: ${JSON.stringify(geometry)}`);
    await page.screenshot({ path: path.join(artifactRoot, 'markdown-slash-menu-above-terminal.png'), scale: 'css' });
    await page.keyboard.press('Escape');

    await page.locator('.workspace-file-row').filter({ hasText: 'keyboard.md' }).click();
    await document.waitFor();
    await document.click();
    for (let level = 1; level <= 3; level += 1) {
      await page.keyboard.type(`${'#'.repeat(level)} `);
      await page.keyboard.type(`Heading ${level}`);
      assert.equal(await document.locator(`h${level}`).last().textContent(), `Heading ${level}`);
      await page.keyboard.press('Enter');
    }

    await page.keyboard.type('- ');
    await page.keyboard.type('Parent');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Child');
    await page.keyboard.press('Tab');
    assert.equal(await document.locator('ul > li > ul > li').count(), 1, 'Tab must indent the current bullet item');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await document.locator('ul > li > ul > li').count(), 0, 'Shift+Tab must outdent the current bullet item');
    assert.equal(await document.locator('ul > li').count(), 2, 'outdented bullet items must remain siblings');

    console.log('react Markdown Document keyboard and terminal-boundary checks passed');
  } finally {
    await app.close().catch(() => {});
    try { execFileSync('pkill', ['-f', `bridge.js --root ${workspace}`]); } catch {}
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
