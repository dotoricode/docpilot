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
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-workspace-tree-'));
  fs.mkdirSync(path.join(fixtureRoot, 'guides', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'empty-folder'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Root\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'guides', 'setup.md'), '# Setup\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'guides', 'deep', 'note.md'), '# Deep Note\n', 'utf8');

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
    await editor.waitForSelector('.workspace-sidebar');
    await editor.waitForSelector('.workspace-tree-search');
    await editor.waitForSelector('.workspace-folder-row');
    await editor.waitForSelector('.workspace-file-row');

    const folderNames = await editor.locator('.workspace-folder-row .tree-name').allInnerTexts();
    if (!folderNames.includes('guides')) {
      throw new Error(`expected guides folder in tree, got: ${folderNames.join(', ')}`);
    }
    if (folderNames.includes('empty-folder')) {
      throw new Error('folders without markdown files should not appear in the tree');
    }

    await editor.locator('.workspace-folder-row').filter({ hasText: 'guides' }).first().click();
    const hiddenAfterCollapse = await editor.locator('.workspace-folder-row').filter({ hasText: 'deep' }).count();
    if (hiddenAfterCollapse !== 0) {
      throw new Error('collapsing a folder should remove nested folder rows from the DOM');
    }

    await editor.locator('.workspace-tree-search').fill('note');
    await editor.waitForSelector('.workspace-file-row');
    const searchRows = await editor.locator('.workspace-file-row .tree-name').allInnerTexts();
    if (!searchRows.includes('note.md') || searchRows.includes('README.md')) {
      throw new Error(`search should show only matching files, got: ${searchRows.join(', ')}`);
    }

    await editor.locator('.workspace-file-row').filter({ hasText: 'note.md' }).first().click();
    await editor.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.markdown-preview h1')).some(node => node.textContent?.trim() === 'Deep Note');
    });
    const title = await editor.locator('.markdown-preview h1').innerText();
    if (title.trim() !== 'Deep Note') {
      throw new Error(`expected nested file preview, got: ${title}`);
    }

    await editor.locator('.workspace-tree-search').fill('');
    await editor.locator('.workspace-folder-row').filter({ hasText: 'guides' }).first().click();
    await editor.evaluate(() => {
      const values = ['created-by-menu.md', 'renamed-by-menu.md', 'empty-created.md', 'new-folder'];
      window.prompt = () => values.shift() || null;
    });
    await editor.locator('.workspace-folder-row').filter({ hasText: 'guides' }).first().click({ button: 'right' });
    await editor.locator('.tree-context-menu button').filter({ hasText: '새 파일' }).click();
    await editor.waitForSelector('.workspace-file-row');
    if (!fs.existsSync(path.join(fixtureRoot, 'guides', 'created-by-menu.md'))) {
      throw new Error('tree context menu should create a file on disk');
    }

    await editor.locator('.workspace-file-row').filter({ hasText: 'created-by-menu.md' }).first().click({ button: 'right' });
    await editor.locator('.tree-context-menu button').filter({ hasText: '이름 변경' }).click();
    await editor.waitForFunction(root => {
      return window.document.body.innerText.includes('renamed-by-menu.md') && !window.document.body.innerText.includes('created-by-menu.md');
    }, fixtureRoot);
    if (!fs.existsSync(path.join(fixtureRoot, 'guides', 'renamed-by-menu.md'))) {
      throw new Error('tree context menu should rename a file on disk');
    }

    const resolvedGuidePath = await editor.evaluate(async () => {
      const port = new URLSearchParams(window.location.search).get('port') || '7474';
      const response = await fetch(`http://localhost:${port}/file-path?id=${encodeURIComponent('guides')}`);
      return response.json();
    });
    if (resolvedGuidePath.path !== path.join(fixtureRoot, 'guides')) {
      throw new Error(`folder path copy API should resolve absolute paths, got ${resolvedGuidePath.path}`);
    }

    await editor.locator('.workspace-tree').evaluate(element => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(160, rect.width - 12),
        clientY: rect.bottom - 8,
      }));
    });
    await editor.locator('.tree-context-menu button').filter({ hasText: /^새 파일$/ }).click();
    await editor.waitForFunction(() => window.document.body.innerText.includes('empty-created.md'));
    if (!fs.existsSync(path.join(fixtureRoot, 'empty-created.md'))) {
      throw new Error('empty tree context menu should create a file at workspace root');
    }

    await editor.locator('.workspace-tree').evaluate(element => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(160, rect.width - 12),
        clientY: rect.bottom - 8,
      }));
    });
    await editor.locator('.tree-context-menu button').filter({ hasText: '새 폴더' }).click();
    if (!fs.statSync(path.join(fixtureRoot, 'new-folder')).isDirectory()) {
      throw new Error('empty tree context menu should create a folder at workspace root');
    }
    if (await editor.locator('.workspace-folder-row').filter({ hasText: 'new-folder' }).count()) {
      throw new Error('new empty folders should stay hidden until they contain markdown files');
    }

    console.log('react workspace tree checks passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
