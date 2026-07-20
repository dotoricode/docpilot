const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

async function waitForEditor(app) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const page = app.windows().find(win => win.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor did not open: ${app.windows().map(win => win.url()).join(', ')}`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-width-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-width-user-'));
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Resizable document\n\nA preview whose scrollbar-side boundary can be dragged.\n');
  const executablePath = process.env.DOCPILOT_ELECTRON_EXECUTABLE || '';
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ['.'] }),
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });
  try {
    const start = await app.firstWindow();
    await start.evaluate(() => {
      localStorage.setItem('docpilot:left-panel-collapsed', '0');
      localStorage.setItem('docpilot:terminal-open', '0');
      localStorage.setItem('docpilot:preview-width', '760');
      localStorage.setItem('docpilot:preview-width-explicit-v1', '1');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
    });
    // Opening a folder intentionally closes the launch window before the IPC
    // promise settles, so do not return that promise to Playwright.
    await start.evaluate(root => { window.docpilot.openFolder(root); }, fixtureRoot);
    const page = await waitForEditor(app);
    await page.setViewportSize({ width: 2048, height: 1152 });
    const release = page.locator('.release-notice-overlay');
    if (await release.count()) await release.getByRole('button', { name: '확인' }).click();
    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await page.waitForSelector('.markdown-preview h1');
    await page.getByRole('button', { name: 'Agent Copy' }).click();
    await page.waitForSelector('.markdown-preview.agent-copy-active');
    const handle = page.locator('.preview-width-resizer');
    await handle.waitFor({ state: 'visible', timeout: 4000 });
    await page.waitForFunction(() => {
      const shell = document.querySelector('.preview-shell')?.getBoundingClientRect();
      const outline = document.querySelector('.toc-rail')?.getBoundingClientRect();
      const resizer = document.querySelector('.preview-width-resizer');
      if (!shell || !outline || !resizer) return false;
      const expectedMaximum = Math.floor(outline.left - shell.left - 48);
      return Number(resizer.getAttribute('aria-valuemax')) >= expectedMaximum - 4;
    });
    const accessible = await handle.evaluate(node => ({
      role: node.getAttribute('role'),
      orientation: node.getAttribute('aria-orientation'),
      value: node.getAttribute('aria-valuenow'),
      label: node.getAttribute('aria-label'),
      width: node.getBoundingClientRect().width,
    }));
    if (accessible.role !== 'separator' || accessible.orientation !== 'vertical' || !accessible.label || accessible.width < 8) {
      throw new Error(`preview resizer must expose an accessible broad hit target: ${JSON.stringify(accessible)}`);
    }
    const geometryBefore = await page.evaluate(() => {
      const shell = document.querySelector('.preview-shell')?.getBoundingClientRect();
      const stage = document.querySelector('.preview-document-stage')?.getBoundingClientRect();
      const outline = document.querySelector('.toc-rail')?.getBoundingClientRect();
      if (!shell || !stage || !outline) throw new Error('preview geometry is unavailable');
      const available = { left: shell.left, right: outline.left, width: outline.left - shell.left };
      return {
        stage: { left: stage.left, right: stage.right, width: stage.width, center: stage.left + stage.width / 2 },
        available: { ...available, center: available.left + available.width / 2 },
      };
    });
    if (Math.abs(geometryBefore.stage.center - geometryBefore.available.center) > 4) {
      throw new Error(`single preview must start centered in the available stage: ${JSON.stringify(geometryBefore)}`);
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate(nextTheme => { document.documentElement.dataset.theme = nextTheme; }, theme);
      await page.screenshot({ path: path.join(artifactRoot, `app-preview-centered-default-${theme}.png`) });
    }
    const box = await handle.boundingBox();
    if (!box) throw new Error('preview width resizer has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(160, box.height / 2));
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 180, box.y + Math.min(160, box.height / 2), { steps: 8 });
    const geometryDuring = await page.locator('.preview-document-stage').evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, center: rect.left + rect.width / 2 };
    });
    await page.mouse.up();
    if (!(geometryDuring.width > geometryBefore.stage.width + 300)) {
      throw new Error(`dragging the boundary 180px must widen both sides symmetrically: ${JSON.stringify({ geometryBefore, geometryDuring })}`);
    }
    if (Math.abs(geometryDuring.center - geometryBefore.stage.center) > 4) {
      throw new Error(`preview center must stay fixed while resizing: ${JSON.stringify({ geometryBefore, geometryDuring })}`);
    }
    const stored = await page.evaluate(() => Number(localStorage.getItem('docpilot:preview-width')));
    if (!Number.isFinite(stored) || Math.abs(stored - geometryDuring.width) > 24) {
      throw new Error(`preview width must persist after drag: ${JSON.stringify({ stored, geometryDuring })}`);
    }
    await page.reload();
    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await page.getByRole('button', { name: 'Agent Copy' }).click();
    await page.waitForSelector('.preview-width-resizer');
    const restored = await page.locator('.preview-document-stage').evaluate(node => node.getBoundingClientRect().width);
    if (Math.abs(restored - geometryDuring.width) > 4) {
      throw new Error(`preview width must restore after reload: ${JSON.stringify({ geometryDuring, restored })}`);
    }
    await page.locator('.preview-width-resizer').focus();
    await page.keyboard.press('End');
    const maximum = await page.evaluate(() => {
      const shell = document.querySelector('.preview-shell')?.getBoundingClientRect();
      const stage = document.querySelector('.preview-document-stage')?.getBoundingClientRect();
      const outline = document.querySelector('.toc-rail')?.getBoundingClientRect();
      if (!shell || !stage || !outline) throw new Error('maximum preview geometry is unavailable');
      return { stageWidth: stage.width, availableWidth: outline.left - shell.left };
    });
    if (Math.abs(maximum.stageWidth - (maximum.availableWidth - 48)) > 4) {
      throw new Error(`End must expand the preview to 24px gutters: ${JSON.stringify(maximum)}`);
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate(nextTheme => { document.documentElement.dataset.theme = nextTheme; }, theme);
      await page.screenshot({ path: path.join(artifactRoot, `app-preview-centered-${theme}.png`) });
    }
    console.log(`${executablePath ? 'packaged ' : ''}react preview width drag checks passed`);
  } finally {
    await app.close().catch(() => {});
    try { execFileSync('pkill', ['-f', `bridge.js --root ${fixtureRoot}`]); } catch {}
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
