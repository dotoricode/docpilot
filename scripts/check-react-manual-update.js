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

async function sendMenuCommand(app, command) {
  await app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows().find(win => win._docpilotWindowKind === 'editor')?.webContents.send('menu-command', value);
  }, command);
}

async function sendUpdateState(app, state) {
  await app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows().find(win => win._docpilotWindowKind === 'editor')?.webContents.send('update-state', value);
  }, state);
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-manual-update-workspace-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-manual-update-user-'));
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Manual update check\n', 'utf8');
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });

  try {
    const start = await app.firstWindow();
    await start.evaluate(root => {
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
      void window.docpilot.openFolder(root);
    }, workspace);
    const editor = await waitForEditor(app);
    await editor.waitForSelector('.bridge-status.connected', { timeout: 15_000 });
    const notice = editor.locator('.release-notice-overlay');
    if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: '확인' }).click();
    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();

    const menuLabel = await app.evaluate(({ Menu }) => {
      const appMenu = Menu.getApplicationMenu();
      const docpilotMenu = appMenu?.items.find(item => item.label === 'DocPilot');
      return docpilotMenu?.submenu?.items.find(item => item.label === '업데이트 확인…')?.label || '';
    });
    assert.equal(menuLabel, '업데이트 확인…');

    await sendMenuCommand(app, 'check-update');
    await editor.waitForSelector('.update-toast');
    await editor.waitForTimeout(800);
    await sendUpdateState(app, {
      status: 'available',
      version: '9.9.9',
      releaseUrl: 'https://github.com/dotoricode/docpilot/releases/tag/v9.9.9',
      fileName: 'DocPilot-9.9.9-arm64.dmg',
    });
    await editor.waitForFunction(() => document.querySelector('.update-card')?.textContent?.includes('v9.9.9'));
    await sendUpdateState(app, { status: 'checking' });
    await editor.waitForFunction(() => document.querySelector('.update-toast')?.textContent?.includes('업데이트를 확인 중입니다.'));
    assert.match(await editor.locator('.update-toast').innerText(), /업데이트를 확인 중입니다\./);

    await sendUpdateState(app, { status: 'latest', version: '2.0.3' });
    await editor.waitForFunction(() => document.querySelector('.update-toast')?.textContent?.includes('최신 버전을 사용 중입니다.'));
    assert.match(await editor.locator('.update-toast').innerText(), /최신 버전을 사용 중입니다\./);
    assert.equal(await editor.locator('.update-toast svg').count(), 1, 'latest toast must show a confirmation icon');
    const toastTypography = await editor.locator('.update-toast-message').evaluate(element => {
      const style = getComputedStyle(element);
      return { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight };
    });
    assert.match(toastTypography.fontFamily, /Geist/i, 'update toast must use the product sans font');
    assert.equal(toastTypography.fontSize, '15px');
    await editor.waitForSelector('.update-toast', { state: 'detached', timeout: 5_000 });

    await sendMenuCommand(app, 'check-update');
    await editor.waitForTimeout(800);
    await sendUpdateState(app, { status: 'error', error: '테스트 네트워크 오류' });
    await editor.waitForFunction(() => document.querySelector('.update-card')?.textContent?.includes('테스트 네트워크 오류'));
    assert.match(await editor.locator('.update-primary-action').innerText(), /다시 확인/);
    console.log('react manual update checks passed');
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
