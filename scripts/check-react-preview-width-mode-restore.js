const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const EXPECTED_WIDTH = 1200;
const WIDTH_TOLERANCE = 4;

async function waitForEditor(app) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const page = app.windows().find(window => window.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor did not open: ${app.windows().map(window => window.url()).join(', ')}`);
}

async function previewWidth(page) {
  return page.locator('.preview-document-stage').evaluate(node => node.getBoundingClientRect().width);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-mode-width-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-mode-width-user-'));
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Width restoration\n\nThe chosen Preview width must survive a Source round trip.\n');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });

  try {
    const start = await app.firstWindow();
    await start.evaluate(width => {
      localStorage.setItem('docpilot:left-panel-collapsed', '0');
      localStorage.setItem('docpilot:terminal-open', '0');
      localStorage.setItem('docpilot:preview-width', String(width));
      localStorage.setItem('docpilot:preview-width-explicit-v1', '1');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
    }, EXPECTED_WIDTH);
    await start.evaluate(root => { window.docpilot.openFolder(root); }, fixtureRoot);

    const page = await waitForEditor(app);
    await page.setViewportSize({ width: 2048, height: 1152 });
    const release = page.locator('.release-notice-overlay');
    if (await release.count()) await release.getByRole('button', { name: '확인' }).click();
    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await page.waitForSelector('.markdown-preview h1');
    await page.getByRole('button', { name: 'Agent Copy', exact: true }).click();
    await page.waitForSelector('.markdown-preview.agent-copy-active');

    const before = await previewWidth(page);
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.waitForSelector('.editor-workspace.edit');
    await page.getByRole('button', { name: 'Document', exact: true }).click();
    const restoredAgentCopy = page.getByRole('button', { name: 'Agent Copy', exact: true });
    if (await restoredAgentCopy.getAttribute('aria-pressed') !== 'true') await restoredAgentCopy.click();
    await page.waitForSelector('.markdown-preview.agent-copy-active');
    await page.waitForTimeout(100);

    const after = await previewWidth(page);
    const stored = await page.evaluate(() => Number(localStorage.getItem('docpilot:preview-width')));
    if (Math.abs(before - EXPECTED_WIDTH) > WIDTH_TOLERANCE) {
      throw new Error(`fixture must start at ${EXPECTED_WIDTH}px: ${JSON.stringify({ before })}`);
    }
    if (Math.abs(after - before) > WIDTH_TOLERANCE || Math.abs(stored - EXPECTED_WIDTH) > WIDTH_TOLERANCE) {
      throw new Error(`Preview width must survive Agent Copy -> Source -> Agent Copy: ${JSON.stringify({ before, after, stored })}`);
    }
    console.log('react preview width mode restore checks passed');
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
