const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function waitForReactEditorWindow(app) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    for (const win of app.windows()) {
      const url = win.url();
      if (url.includes('dist/renderer/index.html') || url.endsWith('/index.html')) return win;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor window did not open. Windows: ${app.windows().map(win => win.url()).join(', ')}`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-react-smoke-'));
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Smoke Test\n\nReact renderer file open.\n', 'utf8');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_FAKE_AGENT: '1',
    },
  });

  try {
    const start = await app.firstWindow();
    await start.waitForLoadState('domcontentloaded');
    await start.evaluate(root => {
      window.docpilot.openFolder(root);
      return true;
    }, fixtureRoot);

    const editor = await waitForReactEditorWindow(app);
    await editor.waitForSelector('.bridge-status');
    await editor.waitForSelector('.workspace-sidebar');
    await editor.waitForSelector('.editor-pane');
    await editor.waitForSelector('.agent-panel');
    await editor.waitForSelector('.agent-controls select');
    await editor.waitForSelector('.agent-activity');
    await editor.waitForSelector('.artifact-rail');
    await editor.waitForSelector('.context-chip-bar');
    await editor.waitForSelector('.changed-files-panel');
    await editor.waitForSelector('.settings-panel');
    await editor.waitForSelector('.workspace-tabs');
    await editor.waitForSelector('.file-row');
    await editor.locator('.file-row').filter({ hasText: 'README.md' }).first().click();
    await editor.waitForSelector('.toc-rail');
    await editor.waitForSelector('.markdown-preview h1');

    const title = await editor.locator('.markdown-preview h1').innerText();
    if (title.trim() !== 'Smoke Test') throw new Error(`unexpected preview title: ${title}`);

    const contextText = await editor.locator('.context-strip').first().innerText();
    if (!contextText.includes('기본') && !contextText.includes('최소') && !contextText.includes('minimal')) {
      throw new Error(`agent context strip did not render: ${contextText}`);
    }
    const bridgeStatus = await editor.locator('.bridge-status').innerText();
    if (!bridgeStatus.includes('문서') && !bridgeStatus.includes('브리지')) {
      throw new Error(`bridge status did not render: ${bridgeStatus}`);
    }

    const metaText = await editor.locator('.agent-meta').innerText();
    if (!metaText.includes('입력') || !metaText.includes('마지막 전체')) {
      throw new Error(`agent metadata did not render input/total chars: ${metaText}`);
    }
    const activityText = await editor.locator('.agent-activity').innerText();
    if (!activityText.includes('활동')) {
      throw new Error(`agent activity line did not render: ${activityText}`);
    }
    await editor.locator('.workspace-tabs button').filter({ hasText: '지침' }).click();
    await editor.waitForSelector('.workspace-instructions-pane .instructions-panel');
    const instructionsVisible = await editor.locator('.workspace-instructions-pane .instructions-panel').count();
    if (!instructionsVisible) {
      throw new Error('instructions panel did not render inside workspace tab');
    }
    const settingsTitle = await editor.locator('.settings-title').innerText();
    if (!settingsTitle.includes('Settings')) {
      throw new Error(`settings panel did not render: ${settingsTitle}`);
    }
    await editor.evaluate(async () => {
      const port = new URLSearchParams(window.location.search).get('port') || '7474';
      await fetch(`http://localhost:${port}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { theme: 'system' } }),
      });
      window.dispatchEvent(new CustomEvent('docpilot-settings-saved', { detail: { settings: { theme: 'system' } } }));
    });
    await editor.waitForFunction(() => document.documentElement.dataset.themePreference === 'system');
    const themePreference = await editor.evaluate(() => document.documentElement.dataset.themePreference);
    if (themePreference !== 'system') {
      throw new Error(`theme preference was not applied: ${themePreference}`);
    }

    console.log('react renderer smoke check passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
