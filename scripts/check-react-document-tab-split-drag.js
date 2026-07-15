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
  throw new Error('React editor did not open');
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-tab-split-'));
  fs.writeFileSync(path.join(fixtureRoot, 'alpha.md'), '# Alpha\n\nPrimary document.\n');
  fs.writeFileSync(path.join(fixtureRoot, 'beta.md'), '# Beta\n\nDragged document.\n');
  const app = await electron.launch({ args: ['.', fixtureRoot], cwd: repoRoot, env: { ...process.env, DOCPILOT_FAKE_AGENT: '1' } });
  try {
    const page = await waitForEditor(app);
    page.setDefaultTimeout(12000);
    const rendererErrors = [];
    page.on('pageerror', error => rendererErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') rendererErrors.push(message.text()); });
    const release = page.locator('.release-notice-overlay');
    if (await release.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) {
      await release.getByRole('button', { name: '확인' }).click();
      await release.waitFor({ state: 'hidden' });
    }
    await page.locator('.workspace-file-row').filter({ hasText: 'alpha.md' }).click();
    await page.locator('.workspace-file-row').filter({ hasText: 'beta.md' }).click();
    await page.waitForSelector('.file-tab');
    await page.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');

    const source = page.locator('.file-tab').filter({ hasText: 'beta.md' }).first();
    const sourceBox = await source.boundingBox();
    const paneBox = await page.locator('.workbench-document-pane').boundingBox();
    if (!sourceBox || !paneBox) throw new Error('document tab drag geometry unavailable');
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 12, sourceBox.y + sourceBox.height / 2 + 8, { steps: 4 });

    const points = {
      left: [0.12, 0.5],
      right: [0.88, 0.5],
      top: [0.5, 0.12],
      bottom: [0.5, 0.88],
    };
    for (const [edge, [xRatio, yRatio]] of Object.entries(points)) {
      await page.mouse.move(paneBox.x + paneBox.width * xRatio, paneBox.y + paneBox.height * yRatio, { steps: 8 });
      await page.waitForSelector(`.document-tab-drop-preview.edge-${edge}`);
      const preview = await page.locator('.document-tab-drop-preview').evaluate(node => {
        const rect = node.getBoundingClientRect();
        const parent = node.parentElement.getBoundingClientRect();
        return { widthRatio: rect.width / parent.width, heightRatio: rect.height / parent.height };
      });
      const horizontalEdge = edge === 'left' || edge === 'right';
      if (horizontalEdge ? Math.abs(preview.widthRatio - 0.5) > 0.03 : Math.abs(preview.heightRatio - 0.5) > 0.03) {
        throw new Error(`${edge} tab preview must show the resulting half: ${JSON.stringify(preview)}`);
      }
      if (edge === 'top') {
        await page.screenshot({ path: path.join(artifactRoot, 'document-tab-split-preview-top-light.png') });
      }
    }

    await page.mouse.move(paneBox.x + paneBox.width * 0.88, paneBox.y + paneBox.height * 0.5, { steps: 8 });
    await page.waitForSelector('.document-tab-drop-preview.edge-right');
    await page.screenshot({ path: path.join(artifactRoot, 'document-tab-split-preview-right-light.png') });
    await page.mouse.up();
    await page.waitForSelector('.preview-compare-horizontal');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.preview-compare-pane.secondary .file-tab')).some(node => node.textContent?.includes('beta.md')));
    if (rendererErrors.length) throw new Error(`document tab split renderer errors: ${rendererErrors.join(' | ')}`);
    console.log('react document tab split drag checks passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
