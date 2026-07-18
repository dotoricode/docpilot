#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const executablePath = process.env.DOCPILOT_ELECTRON_EXECUTABLE || '';
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-terminal-create-workspace-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-terminal-create-user-'));
fs.writeFileSync(path.join(workspace, 'README.md'), '# Terminal creation regression\n', 'utf8');

async function main() {
  let app;
  try {
    app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ['.'] }),
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_USER_DATA_DIR: userData,
    },
  });
    const start = await app.firstWindow();
    await start.waitForLoadState('domcontentloaded');
    await start.evaluate(root => {
    localStorage.setItem('docpilot:terminal-open', '1');
    localStorage.setItem('docpilot:release-notice-seen-id', '2.0.2:r2');
    window.docpilot.openFolder(root);
    return true;
  }, workspace);

    const editor = await waitForEditor(app);
    await editor.waitForSelector('.workspace-file-row', { timeout: 15_000 });
    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await editor.waitForSelector('.terminal-pane', { timeout: 5_000 }).catch(() => {});
    if (!await editor.locator('.terminal-pane').count()) {
      const reopen = editor.getByRole('button', { name: 'Open terminal pane' });
      if (!await reopen.count()) {
        const labels = await editor.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') || button.textContent?.trim()).filter(Boolean));
        assert.fail(`terminal pane and reopen button are missing; visible buttons: ${labels.join(', ')}`);
      }
      await reopen.click();
    }
    await editor.waitForSelector('.terminal-pane');
    await editor.waitForSelector('.terminal-empty');

    let createResponse;
    editor.on('response', response => {
    if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/terminal-sessions') {
      createResponse = response;
    }
    });
    await editor.locator('.terminal-empty').click();
    const outcome = await Promise.race([
    editor.waitForSelector('.terminal-tab.active', { timeout: 10_000 }).then(() => 'tab'),
    editor.waitForSelector('.terminal-error', { timeout: 10_000 }).then(() => 'error'),
    ]);
    if (outcome === 'error') {
      const message = await editor.locator('.terminal-error').innerText();
      const status = createResponse?.status();
      const body = createResponse ? await createResponse.text().catch(() => '') : '';
      assert.fail(`terminal creation failed (status=${status || 'no response'}): ${message}\n${body}`);
    }

    assert(createResponse, 'New terminal click must POST /terminal-sessions');
    assert.equal(createResponse.status(), 200, await createResponse.text());
    const state = await editor.evaluate(async () => {
    const params = new URLSearchParams(window.location.search);
    const port = params.get('port') || '7474';
    const token = params.get('token') || '';
    const response = await fetch(`http://127.0.0.1:${port}/terminal-sessions`, {
      headers: token ? { 'X-DocPilot-Token': token } : {},
    });
    return { status: response.status, body: await response.json() };
    });
    assert.equal(state.status, 200);
    assert.equal(state.body.sessions.length, 1, 'bridge must retain the created terminal session');
    assert.equal(await editor.locator('.terminal-tab.active').count(), 1, 'renderer must show the created terminal tab');

    console.log(`${executablePath ? 'packaged ' : ''}react terminal creation regression passed`);
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

async function waitForEditor(runningApp) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = runningApp.windows().find(window => window.url().includes('dist/renderer/index.html') || window.url().endsWith('/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor window did not open: ${runningApp.windows().map(window => window.url()).join(', ')}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
