const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function waitForEditorWindow(app) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    for (const win of app.windows()) {
      const url = win.url();
      if (url.includes('dist/renderer/index.html') || url.endsWith('/index.html')) return win;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('editor window did not open');
}

async function main() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-nav-'));
  fs.writeFileSync(
    path.join(fixtureRoot, 'index.md'),
    '# Link navigation repro\n\n[Missing ADR](adr/ADR-DOC-0001-multi-repo-documentation-strategy.md)\n',
    'utf8'
  );

  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
    },
  });

  try {
    const start = await app.firstWindow();
    await start.waitForLoadState('domcontentloaded');
    await start.evaluate(root => {
      window.docpilot.openFolder(root);
      return true;
    }, fixtureRoot);
    const editor = await waitForEditorWindow(app);
    await editor.waitForSelector('.workspace-sidebar');
    await editor.waitForSelector('.file-row');
    const releaseNotice = editor.locator('.release-notice-overlay');
    if (await releaseNotice.isVisible().catch(() => false)) await releaseNotice.click({ position: { x: 8, y: 8 } });
    await editor.locator('.file-row').filter({ hasText: 'index.md' }).first().click();
    await editor.waitForSelector('.markdown-preview a');

    const before = editor.url();
    await editor.locator('.markdown-preview a').click({ noWaitAfter: true });
    await editor.waitForTimeout(500);
    const after = editor.url();

    if (!before.includes('dist/renderer/index.html') && !before.endsWith('/index.html')) {
      throw new Error(`expected React renderer before click, got ${before}`);
    }
    if (!after.includes('dist/renderer/index.html') && !after.endsWith('/index.html')) {
      throw new Error(`preview link navigated editor away from shell: ${after}`);
    }

    console.log('editor navigation guard ok');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
