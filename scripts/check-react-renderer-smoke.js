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
    await editor.waitForSelector('.home-screen');
    if (await editor.locator('.release-notice-overlay').count()) {
      await editor.locator('.release-notice-modal footer button').filter({ hasText: '확인' }).click();
      await editor.waitForSelector('.release-notice-overlay', { state: 'detached' });
    }
    const homeTitle = await editor.locator('.home-project-heading h1').innerText();
    if (homeTitle.trim() !== path.basename(fixtureRoot)) {
      throw new Error(`home screen did not render expected title: ${homeTitle}`);
    }
    await editor.waitForSelector('.workspace-file-row');
    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await editor.waitForSelector('.toc-rail');
    await editor.waitForFunction(() => {
      const heading = document.querySelector('.markdown-preview h1');
      return heading && heading.textContent && heading.textContent.trim() === 'Smoke Test';
    });

    const title = await editor.locator('.markdown-preview h1').innerText();
    if (title.trim() !== 'Smoke Test') throw new Error(`unexpected preview title: ${title}`);

    await editor.getByRole('button', { name: 'Collapse project panel' }).waitFor();
    const topbarPanelButtons = await editor.locator('.topbar-right .panel-toggle-button').count();
    if (topbarPanelButtons) {
      throw new Error('panel collapse buttons should live inside their panels, not the top bar');
    }
    await editor.getByRole('button', { name: 'Collapse project panel' }).click();
    await editor.waitForSelector('.left-rail .panel-rail-open-button');
    await editor.getByRole('button', { name: 'Open project panel' }).click();
    await editor.waitForSelector('.workspace-sidebar');

    await editor.locator('.editor-mode-toggle button').filter({ hasText: 'Source' }).click();
    await editor.waitForFunction(() => {
      const numbers = Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
        .map(node => (node.textContent || '').trim())
        .filter(Boolean);
      return numbers.length > 0;
    });
    const lineNumberText = await editor.locator('.cm-lineNumbers .cm-gutterElement').evaluateAll(nodes => (
      nodes.map(node => (node.textContent || '').trim()).filter(Boolean).join(',')
    ));
    if (!lineNumberText) {
      throw new Error('edit mode should show CodeMirror line numbers');
    }
    await editor.locator('.editor-mode-toggle button').filter({ hasText: 'Document' }).click();
    await editor.waitForSelector('.markdown-preview h1');

    const bridgeStatus = await editor.locator('.bridge-status').innerText();
    if (!bridgeStatus.includes('문서') && !bridgeStatus.includes('브리지')) {
      throw new Error(`bridge status did not render: ${bridgeStatus}`);
    }

    await editor.locator('.workspace-tabs button').filter({ hasText: '지침' }).evaluate(button => button.click());
    await editor.waitForSelector('.workspace-instructions-pane .instructions-panel');
    const instructionsVisible = await editor.locator('.workspace-instructions-pane .instructions-panel').count();
    if (!instructionsVisible) {
      throw new Error('instructions panel did not render inside workspace tab');
    }

    await editor.locator('.app-logo').click();
    await editor.waitForSelector('.home-screen');
    const returnedHomeVisible = await editor.locator('.home-project-heading h1').innerText();
    if (returnedHomeVisible.trim() !== path.basename(fixtureRoot)) {
      throw new Error(`DocPilot logo did not return to home: ${returnedHomeVisible}`);
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
