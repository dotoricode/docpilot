const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

async function waitForEditor(app) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const page = app.windows().find(window => window.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('React editor did not open');
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-performance-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-performance-user-'));
  const body = Array.from({ length: 120 }, (_, index) => `## Section ${index + 1}\n\nPreview width performance fixture paragraph ${index + 1}.`).join('\n\n');
  fs.writeFileSync(path.join(fixtureRoot, 'PERFORMANCE.md'), `# Resize performance\n\n${body}\n`);

  const app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });

  try {
    const start = await app.firstWindow();
    await start.evaluate(() => {
      localStorage.setItem('docpilot:left-panel-collapsed', '0');
      localStorage.setItem('docpilot:terminal-open', '0');
      localStorage.setItem('docpilot:preview-width', '760');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.0:r2');
    });
    await start.evaluate(folder => { window.docpilot.openFolder(folder); }, fixtureRoot);

    const page = await waitForEditor(app);
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.locator('.workspace-file-row').filter({ hasText: 'PERFORMANCE.md' }).click();
    await page.waitForSelector('.preview-width-resizer');

    await page.evaluate(() => {
      window.__previewWidthStorageWrites = 0;
      window.__previewWidthMoveEvents = 0;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function patchedSetItem(key, value) {
        if (key === 'docpilot:preview-width') window.__previewWidthStorageWrites += 1;
        return originalSetItem.call(this, key, value);
      };
      window.addEventListener('mousemove', () => { window.__previewWidthMoveEvents += 1; }, true);
    });

    const handle = page.locator('.preview-width-resizer');
    const box = await handle.boundingBox();
    if (!box) throw new Error('preview width resizer has no bounding box');
    const beforeWidth = await page.locator('.preview-document-stage').evaluate(node => node.getBoundingClientRect().width);

    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    for (let index = 1; index <= 48; index += 1) {
      await page.mouse.move(box.x + box.width / 2 + index * 4, box.y + 200);
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    const metrics = await page.evaluate(() => ({
      moveEvents: window.__previewWidthMoveEvents,
      storageWrites: window.__previewWidthStorageWrites,
      storedWidth: Number(localStorage.getItem('docpilot:preview-width')),
      renderedWidth: document.querySelector('.preview-document-stage')?.getBoundingClientRect().width || 0,
    }));

    assertMetric(metrics.moveEvents >= 40, `performance fixture emitted too few move events: ${JSON.stringify(metrics)}`);
    assertMetric(metrics.storageWrites <= 2, `drag must commit preview width at most twice instead of once per move: ${JSON.stringify(metrics)}`);
    assertMetric(metrics.renderedWidth > beforeWidth + 300, `drag did not resize the preview: ${JSON.stringify({ beforeWidth, metrics })}`);
    assertMetric(Math.abs(metrics.storedWidth - metrics.renderedWidth) <= 24, `final width was not persisted: ${JSON.stringify(metrics)}`);

    console.log(`react preview resize performance passed: ${JSON.stringify(metrics)}`);
  } finally {
    await app.close().catch(() => {});
    try { execFileSync('pkill', ['-f', `bridge.js --root ${fixtureRoot}`]); } catch {}
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

function assertMetric(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
