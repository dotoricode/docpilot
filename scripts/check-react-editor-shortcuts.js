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

async function editorText(editor) {
  return editor.locator('.cm-content').evaluate(node => node.textContent || '');
}

async function clipboardText(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

async function setClipboardText(app, text) {
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const executablePath = process.env.DOCPILOT_ELECTRON_EXECUTABLE || '';
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-editor-shortcuts-'));
  fs.writeFileSync(path.join(fixtureRoot, 'shortcuts.md'), '# Shortcuts\n\nalpha\n', 'utf8');

  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
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
    await editor.waitForSelector('.workspace-sidebar');
    await editor.locator('.file-row').filter({ hasText: 'shortcuts.md' }).first().click();
    await editor.locator('.editor-mode-toggle button').filter({ hasText: '편집' }).click();
    await editor.waitForSelector('.cm-editor');
    await editor.locator('.cm-content').click();

    await editor.keyboard.press(`${mod}+A`);
    await editor.keyboard.type('line');
    await editor.keyboard.press(`${mod}+ArrowLeft`);
    await editor.keyboard.press('Tab');
    const tabbedLine = await editor.locator('.cm-line').first().evaluate(node => node.textContent || '');
    if (!/^\s+line$/.test(tabbedLine)) {
      throw new Error(`Tab should indent the current line, got: ${JSON.stringify(tabbedLine)}`);
    }

    await editor.keyboard.type('x');
    let text = await editorText(editor);
    if (!text.includes('x')) throw new Error(`typed text was not inserted: ${text}`);
    await editor.keyboard.press(`${mod}+Z`);
    text = await editorText(editor);
    if (text.includes('x')) throw new Error(`Cmd/Ctrl+Z should undo the last insertion, got: ${text}`);
    await editor.keyboard.press(process.platform === 'darwin' ? `${mod}+Shift+Z` : `${mod}+Y`);
    text = await editorText(editor);
    if (!text.includes('x')) throw new Error(`redo shortcut should restore the insertion, got: ${text}`);

    await editor.keyboard.press(`${mod}+A`);
    await editor.keyboard.press(`${mod}+C`);
    const copied = await clipboardText(app);
    if (!copied.includes('line') || !copied.includes('x')) {
      throw new Error(`copy shortcut should write editor selection, got: ${copied}`);
    }

    await setClipboardText(app, '\nPASTED');
    await editor.keyboard.press(`${mod}+ArrowRight`);
    await editor.keyboard.press(`${mod}+V`);
    text = await editorText(editor);
    if (!text.includes('PASTED')) {
      throw new Error(`paste shortcut should insert clipboard text, got: ${text}`);
    }

    console.log(`${executablePath ? 'packaged ' : ''}react editor shortcut check passed`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
