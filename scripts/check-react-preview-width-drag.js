const fs = require('fs');
const os = require('os');
const path = require('path');
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
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-width-'));
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Resizable document\n\nA preview whose scrollbar-side boundary can be dragged.\n');
  const app = await electron.launch({ args: ['.'], cwd: repoRoot, env: { ...process.env, DOCPILOT_FAKE_AGENT: '1' } });
  try {
    const start = await app.firstWindow();
    await start.evaluate(root => {
      localStorage.setItem('docpilot:left-panel-collapsed', '0');
      localStorage.setItem('docpilot:terminal-open', '0');
      localStorage.removeItem('docpilot:preview-width');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.0:r2');
      window.docpilot.openFolder(root);
    }, fixtureRoot);
    const page = await waitForEditor(app);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const release = page.locator('.release-notice-overlay');
    if (await release.count()) await release.getByRole('button', { name: '확인' }).click();
    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await page.waitForSelector('.markdown-preview h1');
    const handle = page.locator('.preview-width-resizer');
    await handle.waitFor({ state: 'visible', timeout: 4000 });
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
    const before = await page.locator('.preview-document-stage').evaluate(node => node.getBoundingClientRect().width);
    const box = await handle.boundingBox();
    if (!box) throw new Error('preview width resizer has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(160, box.height / 2));
    await page.mouse.down();
    await page.mouse.move(box.x - 220, box.y + Math.min(160, box.height / 2), { steps: 8 });
    const during = await page.locator('.preview-document-stage').evaluate(node => node.getBoundingClientRect().width);
    await page.mouse.up();
    if (!(during < before - 150)) {
      throw new Error(`dragging the scrollbar-side boundary left must narrow the document: ${JSON.stringify({ before, during })}`);
    }
    const stored = await page.evaluate(() => Number(localStorage.getItem('docpilot:preview-width')));
    if (!Number.isFinite(stored) || Math.abs(stored - during) > 24) {
      throw new Error(`preview width must persist after drag: ${JSON.stringify({ stored, during })}`);
    }
    await page.reload();
    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await page.waitForSelector('.preview-width-resizer');
    const restored = await page.locator('.preview-document-stage').evaluate(node => node.getBoundingClientRect().width);
    if (Math.abs(restored - during) > 4) {
      throw new Error(`preview width must restore after reload: ${JSON.stringify({ during, restored })}`);
    }
    await page.locator('.preview-width-resizer').focus();
    await page.keyboard.press('ArrowRight');
    const keyboardWidth = await page.locator('.preview-document-stage').evaluate(node => node.getBoundingClientRect().width);
    if (!(keyboardWidth > restored)) throw new Error('ArrowRight must widen the focused preview separator');
    console.log('react preview width drag checks passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
