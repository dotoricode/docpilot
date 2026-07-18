#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

async function sendUpdateState(app, state) {
  await app.evaluate(({ BrowserWindow }, nextState) => {
    const editor = BrowserWindow.getAllWindows().find(win => win._docpilotWindowKind === 'editor');
    editor?.webContents.send('update-state', nextState);
  }, state);
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-update-preservation-workspace-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-update-preservation-user-'));
  const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Update preservation\n\nInitial body.\n', 'utf8');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_FAKE_AGENT_DELAY_MS: '1000',
      DOCPILOT_USER_DATA_DIR: userData,
    },
  });

  try {
    const start = await app.firstWindow();
    await start.waitForLoadState('domcontentloaded');
    await start.evaluate(root => {
      localStorage.setItem('docpilot:terminal-open', '1');
      void window.docpilot.openFolder(root);
    }, workspace);

    const editor = await waitForEditor(app);
    await editor.waitForSelector('.bridge-status.connected', { timeout: 15_000 });
    const releaseNotice = editor.locator('.release-notice-overlay');
    if (await releaseNotice.isVisible().catch(() => false)) {
      await releaseNotice.getByRole('button', { name: '확인' }).click();
    }
    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await editor.locator('.editor-mode-toggle button').filter({ hasText: 'Source' }).click();
    await editor.locator('.cm-content').click();
    await editor.keyboard.press('End');
    await editor.keyboard.type('\nUnsaved update marker');
    await editor.waitForSelector('.dirty-pill');

    await editor.waitForSelector('.terminal-empty');
    await editor.locator('.terminal-empty').click();
    await editor.waitForSelector('.terminal-tab.active', { timeout: 10_000 });

    const agentSessionId = await editor.evaluate(async () => {
      const params = new URLSearchParams(window.location.search);
      const base = `http://127.0.0.1:${params.get('port') || '7474'}`;
      const token = params.get('token') || '';
      const headers = { 'Content-Type': 'application/json', ...(token ? { 'X-DocPilot-Token': token } : {}) };
      const created = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ agent: 'claude', title: 'Update preservation agent' }),
      }).then(response => response.json());
      const sessionId = created.session.id;
      window.__docpilotUpdateTurn = fetch(`${base}/sessions/${encodeURIComponent(sessionId)}/turn`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: '업데이트 중 세션 보존을 확인해줘.' }),
      }).then(response => response.text());
      return sessionId;
    });
    await editor.waitForFunction(async sessionId => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || '';
      const response = await fetch(`http://127.0.0.1:${params.get('port') || '7474'}/sessions/${encodeURIComponent(sessionId)}`, {
        headers: token ? { 'X-DocPilot-Token': token } : {},
      });
      const detail = await response.json();
      return detail.session?.status === 'running';
    }, agentSessionId, { timeout: 8_000 });

    const baseState = {
      version: '9.9.9',
      releaseUrl: 'https://github.com/dotoricode/docpilot/releases/tag/v9.9.9',
      fileName: 'DocPilot-9.9.9-arm64.dmg',
      size: 144_000_000,
    };
    await sendUpdateState(app, { status: 'available', ...baseState });
    await editor.waitForSelector('.update-card');
    assert.match(await editor.locator('.update-card').innerText(), /세션과 편집 중인 문서는 유지/);
    await editor.screenshot({ path: path.join(artifactRoot, 'update-card-available.png'), scale: 'css' });

    await sendUpdateState(app, { status: 'downloading', ...baseState, received: 53_280_000, percent: 37 });
    await editor.waitForFunction(() => document.querySelector('.update-primary-action')?.textContent?.includes('37%'));

    const preserved = await editor.evaluate(() => ({
      dirty: Boolean(document.querySelector('.dirty-pill')),
      draft: document.querySelector('.cm-content')?.textContent || '',
      terminalTabs: document.querySelectorAll('.terminal-tab.active').length,
      agentActive: false,
    }));
    preserved.agentActive = await editor.evaluate(async sessionId => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || '';
      const response = await fetch(`http://127.0.0.1:${params.get('port') || '7474'}/sessions/${encodeURIComponent(sessionId)}`, {
        headers: token ? { 'X-DocPilot-Token': token } : {},
      });
      const detail = await response.json();
      return detail.session?.status === 'running';
    }, agentSessionId);
    assert.equal(preserved.dirty, true, 'dirty document marker must remain during download');
    assert.match(preserved.draft, /Unsaved update marker/, 'dirty editor text must remain during download');
    assert.equal(preserved.terminalTabs, 1, 'terminal session tab must remain during download');
    assert.equal(preserved.agentActive, true, 'agent turn must remain active during download');

    await sendUpdateState(app, {
      status: 'downloaded',
      ...baseState,
      received: baseState.size,
      percent: 100,
      digest: `sha256:${'a'.repeat(64)}`,
    });
    await editor.waitForFunction(() => document.querySelector('.update-primary-action')?.textContent?.includes('DMG 열기'));
    assert.equal(app.windows().some(window => window.url().includes('dist/renderer/index.html')), true, 'download completion must not close the editor window');
    assert.equal(await editor.locator('.dirty-pill').count(), 1, 'download completion must not clear dirty state');

    await editor.locator('.theme-toggle button').filter({ hasText: 'Dark' }).click();
    await editor.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await sendUpdateState(app, { status: 'error', ...baseState, error: 'SHA-256 검증에 실패했습니다.' });
    await editor.waitForFunction(() => document.querySelector('.update-primary-action')?.textContent?.includes('다시 다운로드'));
    assert.match(await editor.locator('.update-card-error').innerText(), /SHA-256/);
    await editor.screenshot({ path: path.join(artifactRoot, 'update-card-error-dark.png'), scale: 'css' });

    await editor.getByRole('button', { name: '업데이트 안내 닫기' }).click();
    await editor.waitForSelector('.update-card', { state: 'detached' });
    assert.equal(await editor.locator('.terminal-tab.active').count(), 1, 'closing the update card must not close terminal sessions');
    assert.equal(await editor.locator('.dirty-pill').count(), 1, 'closing the update card must not clear dirty state');

    console.log('react update preservation regression passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
