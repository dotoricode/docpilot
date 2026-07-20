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
  const executablePath = process.env.DOCPILOT_ELECTRON_EXECUTABLE || '';
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-instruction-import-'));
  const importPath = path.join(fixtureRoot, 'agent-guide.md');
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Import Fixture\n', 'utf8');
  fs.writeFileSync(importPath, 'Imported instruction body.\n\nUse project language.\n', 'utf8');

  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ['.'] }),
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
    await app.evaluate(({ BrowserWindow }) => {
      const editorWindow = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
      editorWindow?.setSize(1280, 900);
    });
    await editor.waitForSelector('.workspace-sidebar');
    await editor.locator('.workspace-tabs button').filter({ hasText: '지침' }).evaluate(button => button.click());
    await editor.waitForSelector('.instructions-panel');
    await editor.locator('[data-testid="instruction-file-input"]').setInputFiles(importPath);
    await editor.waitForFunction(() => {
      const title = document.querySelector('.instruction-form input');
      const body = document.querySelector('.instruction-form textarea');
      return title?.value === 'agent-guide' && body?.value.includes('Use project language.');
    });

    const title = await editor.locator('.instruction-form input').first().inputValue();
    const body = await editor.locator('.instruction-form textarea').inputValue();
    if (title !== 'agent-guide') {
      throw new Error(`imported instruction title should come from filename, got: ${title}`);
    }
    if (!body.includes('Imported instruction body.') || !body.includes('Use project language.')) {
      throw new Error(`imported instruction body did not load file content, got: ${body}`);
    }

    const actions = await editor.locator('.instruction-form-actions').innerText();
    if (!actions.includes('파일 불러오기') || !actions.includes('지침 저장')) {
      throw new Error(`instruction import/save actions should be grouped and readable, got: ${actions}`);
    }

    console.log(`${executablePath ? 'packaged ' : ''}react instruction import check passed`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
