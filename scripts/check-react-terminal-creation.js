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
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_TEST_DISABLE_FISH: '1',
    },
  });
    const start = await app.firstWindow();
    await start.waitForLoadState('domcontentloaded');
    await start.evaluate(root => {
    localStorage.setItem('docpilot:terminal-open', '1');
    window.__docpilotOpenFolderError = '';
    window.docpilot.openFolder(root).catch(error => {
      window.__docpilotOpenFolderError = String(error);
    });
    return true;
  }, workspace);

    const editor = await waitForEditor(app, start);
    await editor.waitForSelector('.workspace-file-row', { timeout: 60_000 });
    const releaseNotice = editor.getByRole('dialog', { name: '새 버전 안내' });
    if (await releaseNotice.isVisible().catch(() => false)) {
      await releaseNotice.getByRole('button', { name: '확인' }).click();
    }
    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().evaluate(button => button.click());
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

    const chooser = editor.getByRole('button', { name: 'Choose terminal shell' });
    const emptyChooser = editor.getByRole('button', { name: 'Choose shell…' });
    await emptyChooser.waitFor();
    await emptyChooser.click();
    const terminalMenu = editor.getByRole('menu', { name: 'Terminal shells' });
    await terminalMenu.waitFor();
    assert.equal(await terminalMenu.getByRole('menuitem').count(), 4, 'terminal chooser must keep the fixed shell allowlist');
    assert.equal(await terminalMenu.getByText('Runs inside DocPilot · Change the default in Settings').count(), 1, 'terminal chooser must explain that shells stay embedded');
    for (const label of ['Default shell', 'fish', 'zsh', 'bash']) {
      assert.equal(await terminalMenu.getByRole('menuitem', { name: new RegExp(label) }).count(), 1, `terminal chooser must include ${label}`);
    }
    assert.equal(await terminalMenu.getByText(/Built-in autosuggestions · Ctrl\+F to accept/).count(), 1, 'fish must explain its Warp-like autosuggestion behavior');
    if (process.env.DOCPILOT_TERMINAL_SCREENSHOT) {
      await editor.screenshot({ path: process.env.DOCPILOT_TERMINAL_SCREENSHOT, scale: 'css' });
    }
    const settingsBeforeInstall = await editor.evaluate(async () => {
      const params = new URLSearchParams(window.location.search);
      const port = params.get('port') || '7474';
      const token = params.get('token') || '';
      const response = await fetch(`http://127.0.0.1:${port}/settings`, {
        headers: token ? { 'X-DocPilot-Token': token } : {},
      });
      return (await response.json()).settings;
    });
    let pretendFishInstalled = false;
    await editor.route('**/terminal-shells/fish/install', async route => {
      pretendFishInstalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          alreadyInstalled: false,
          shell: { id: 'fish', label: 'fish', description: 'Built-in autosuggestions · Ctrl+F to accept', available: true, installable: false, path: '/test/bin/fish' },
          settings: { ...settingsBeforeInstall, defaultTerminalShell: 'fish' },
        }),
      });
    });
    await editor.route('**/terminal-shells', async route => {
      if (!pretendFishInstalled) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shells: [
          { id: 'default', label: 'Default shell', description: 'Use your macOS login shell', available: true, installable: false, path: '/bin/zsh' },
          { id: 'fish', label: 'fish', description: 'Built-in autosuggestions · Ctrl+F to accept', available: true, installable: false, path: '/test/bin/fish' },
          { id: 'zsh', label: 'zsh', description: 'Load your interactive zsh configuration', available: true, installable: false, path: '/bin/zsh' },
          { id: 'bash', label: 'bash', description: 'Load your interactive bash configuration', available: true, installable: false, path: '/bin/bash' },
        ] }),
      });
    });
    const fishInstaller = terminalMenu.getByRole('menuitem', { name: /fish Built-in autosuggestions .* Not installed Install/ });
    assert.equal(await fishInstaller.isEnabled(), true, 'missing fish must expose a Homebrew install action');
    editor.once('dialog', dialog => dialog.accept());
    await fishInstaller.click();
    await terminalMenu.getByText('fish installed · Select it to open a terminal').waitFor();
    await editor.locator('.terminal-new-primary[aria-label="New terminal with fish"]').waitFor();
    const installedFish = terminalMenu.getByRole('menuitem', { name: /^fish Built-in autosuggestions/ });
    assert.equal(await installedFish.isEnabled(), true, 'fish must become selectable after installation');
    await chooser.click();

    const savedDefault = await editor.evaluate(async () => {
      const params = new URLSearchParams(window.location.search);
      const port = params.get('port') || '7474';
      const token = params.get('token') || '';
      const headers = { 'Content-Type': 'application/json', ...(token ? { 'X-DocPilot-Token': token } : {}) };
      const current = await fetch(`http://127.0.0.1:${port}/settings`, { headers }).then(response => response.json());
      const response = await fetch(`http://127.0.0.1:${port}/settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ settings: { ...current.settings, defaultTerminalShell: 'zsh' } }),
      }).then(result => result.json());
      window.dispatchEvent(new CustomEvent('docpilot-settings-saved', { detail: { settings: response.settings } }));
      return response.settings.defaultTerminalShell;
    });
    assert.equal(savedDefault, 'zsh');
    await editor.locator('.terminal-new-primary[aria-label="New terminal with zsh"]').waitFor();

    let createResponse;
    let deleteResponse;
    editor.on('response', response => {
      const method = response.request().method();
      const pathname = new URL(response.url()).pathname;
      if (method === 'POST' && pathname === '/terminal-sessions') createResponse = response;
      if (method === 'DELETE' && pathname.startsWith('/terminal-sessions/')) deleteResponse = response;
    });
    await chooser.click();
    await terminalMenu.getByRole('menuitem', { name: /^Default shell Use your macOS login shell$/ }).click();
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
    assert.equal(createResponse.request().postDataJSON().shellId, 'default', 'one-time shell choice must be sent to the embedded terminal session API');
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
    assert.equal(state.body.sessions[0].shellId, 'default', 'bridge must run the chosen shell inside the retained terminal session');
    assert.equal(await editor.locator('.terminal-tab.active').count(), 1, 'renderer must show the created terminal tab');
    const persistedDefault = await editor.evaluate(async () => {
      const params = new URLSearchParams(window.location.search);
      const port = params.get('port') || '7474';
      const token = params.get('token') || '';
      const response = await fetch(`http://127.0.0.1:${port}/settings`, {
        headers: token ? { 'X-DocPilot-Token': token } : {},
      });
      return (await response.json()).settings.defaultTerminalShell;
    });
    assert.equal(persistedDefault, 'zsh', 'a one-time shell choice must not replace the saved default');

    await editor.locator('.terminal-tab.active svg').last().click();
    await editor.waitForSelector('.terminal-tab.active', { state: 'detached' });
    await editor.waitForTimeout(300);
    assert(deleteResponse, 'closing a terminal tab must issue DELETE /terminal-sessions/:id');
    assert.equal(deleteResponse.status(), 200, await deleteResponse.text());
    assert.equal(
      await editor.locator('.terminal-error').count(),
      0,
      `closing a terminal tab must not report a connection failure: ${await editor.locator('.terminal-error').allTextContents()}`,
    );

    console.log(`${executablePath ? 'packaged ' : ''}react terminal creation regression passed`);
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

async function waitForEditor(runningApp, startWindow) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = runningApp.windows().find(window => window.url().includes('dist/renderer/index.html') || window.url().endsWith('/index.html'));
    if (page) return page;
    const openFolderError = await startWindow.evaluate(() => window.__docpilotOpenFolderError || '').catch(() => '');
    if (openFolderError) throw new Error(`React editor window did not open: ${openFolderError}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor window did not open: ${runningApp.windows().map(window => window.url()).join(', ')}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
