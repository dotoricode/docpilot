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

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-terminal-narrow-workspace-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-terminal-narrow-user-'));
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Narrow terminal\n', 'utf8');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });

  try {
    const start = await app.firstWindow();
    await start.evaluate(root => {
      localStorage.setItem('docpilot:terminal-open', '1');
      localStorage.setItem('docpilot:terminal-orientation', 'horizontal');
      localStorage.setItem('docpilot:terminal-size', '320');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
      void window.docpilot.openFolder(root);
    }, workspace);

    const editor = await waitForEditor(app);
    await editor.setViewportSize({ width: 1040, height: 760 });
    await editor.waitForSelector('.bridge-status.connected', { timeout: 15_000 });
    const releaseNotice = editor.locator('.release-notice-overlay');
    if (await releaseNotice.isVisible().catch(() => false)) {
      await releaseNotice.getByRole('button', { name: '확인' }).click();
    }
    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await editor.waitForSelector('.terminal-pane');
    const emptyTerminal = editor.locator('.terminal-empty');
    if (await emptyTerminal.isVisible().catch(() => false)) await emptyTerminal.click();
    else await editor.getByRole('button', { name: 'New terminal' }).click();
    await editor.waitForSelector('.terminal-tab.active', { timeout: 10_000 });

    const geometry = await editor.evaluate(() => {
      const pane = document.querySelector('.terminal-pane');
      const tabbar = document.querySelector('.terminal-tabbar');
      const tabs = document.querySelector('.terminal-tabs');
      const tab = document.querySelector('.terminal-tab.active span');
      const create = document.querySelector('[aria-label="New terminal"]');
      const dock = document.querySelector('[aria-label="Dock terminal right"]');
      if (!(pane instanceof HTMLElement) || !(tabbar instanceof HTMLElement) || !(tabs instanceof HTMLElement)) {
        throw new Error('terminal geometry is unavailable');
      }
      const rect = pane.getBoundingClientRect();
      return {
        paneWidth: rect.width,
        tabbarClientWidth: tabbar.clientWidth,
        tabbarScrollWidth: tabbar.scrollWidth,
        tabbarClientHeight: tabbar.clientHeight,
        tabbarScrollHeight: tabbar.scrollHeight,
        tabsClientWidth: tabs.clientWidth,
        tabsScrollWidth: tabs.scrollWidth,
        tabsClientHeight: tabs.clientHeight,
        tabsScrollHeight: tabs.scrollHeight,
        tabTitle: tab?.textContent || '',
        newTerminalVisible: create instanceof HTMLElement && create.getBoundingClientRect().width > 0,
        dockVisible: dock instanceof HTMLElement && dock.getBoundingClientRect().width > 0,
      };
    });

    assert.ok(geometry.paneWidth >= 300 && geometry.paneWidth <= 340, JSON.stringify(geometry));
    assert.ok(geometry.tabsScrollWidth <= geometry.tabsClientWidth + 1, `terminal tabs must not scroll horizontally: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.tabsScrollHeight <= geometry.tabsClientHeight + 1, `terminal tabs must not scroll vertically: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.tabbarScrollWidth <= geometry.tabbarClientWidth + 1, `terminal tabbar must not overflow horizontally: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.tabbarScrollHeight <= geometry.tabbarClientHeight + 1, `terminal tabbar must not overflow vertically: ${JSON.stringify(geometry)}`);
    assert.equal(geometry.newTerminalVisible, true, 'New terminal control must remain visible');
    assert.equal(geometry.dockVisible, true, 'dock controls must remain visible');
    console.log('react terminal narrow layout checks passed');
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
