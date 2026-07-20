const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
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

async function submitInlineTreeEdit(editor, value) {
  const input = editor.locator('.tree-inline-input').first();
  try {
    await input.waitFor({ timeout: 5000 });
  } catch (err) {
    const treeState = await editor.evaluate(() => ({
      inlineInputs: document.querySelectorAll('.tree-inline-input').length,
      editingRows: Array.from(document.querySelectorAll('[data-editing="true"]')).map(node => node.textContent),
      files: Array.from(document.querySelectorAll('.workspace-file-row')).map(node => ({
        title: node.getAttribute('title'),
        text: node.textContent,
      })),
      folders: Array.from(document.querySelectorAll('.workspace-folder-row')).map(node => ({
        title: node.getAttribute('title'),
        text: node.textContent,
        expanded: node.className,
      })),
    }));
    throw new Error(`inline tree input did not appear: ${JSON.stringify(treeState)}`);
  }
  await input.click();
  await editor.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await editor.keyboard.type(value);
  const editState = await editor.evaluate(() => ({
    activeTag: document.activeElement?.tagName,
    activeClass: document.activeElement?.getAttribute('class'),
    activeValue: document.activeElement instanceof HTMLInputElement ? document.activeElement.value : '',
    inlineValues: Array.from(document.querySelectorAll('.tree-inline-input')).map(input => input instanceof HTMLInputElement ? input.value : ''),
    files: Array.from(document.querySelectorAll('.workspace-file-row')).map(node => ({
      title: node.getAttribute('title'),
      text: node.textContent,
      editing: node.getAttribute('data-editing'),
    })),
    folders: Array.from(document.querySelectorAll('.workspace-folder-row')).map(node => ({
      title: node.getAttribute('title'),
      text: node.textContent,
      className: node.getAttribute('class'),
      editing: node.getAttribute('data-editing'),
    })),
    bodyText: document.body.innerText.slice(0, 1000),
  }));
  if (!editState.inlineValues.includes(value) && editState.activeValue !== value) {
    throw new Error(`inline tree input did not receive typed value: ${JSON.stringify(editState)}`);
  }
  await editor.keyboard.press('Enter');
}

async function cancelInlineTreeEdit(editor) {
  const input = editor.locator('.tree-inline-input').first();
  await input.waitFor({ timeout: 5000 });
  await input.click();
  await editor.keyboard.press('Escape');
}

async function readClipboard(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

async function waitForPath(predicate, message) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(typeof message === 'function' ? await message() : message);
}

function listFixtureFiles(root) {
  const out = [];
  function walk(dir, rel = '') {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const nextRel = rel ? `${rel}/${name}` : name;
      out.push(nextRel);
      if (fs.statSync(abs).isDirectory()) walk(abs, nextRel);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-workspace-tree-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-workspace-tree-user-'));
  const workspaceStateKey = crypto.createHash('sha256').update(fs.realpathSync(fixtureRoot)).digest('hex');
  const trashRoot = path.join(userData, 'workspaces', workspaceStateKey, 'trash');
  fs.mkdirSync(path.join(fixtureRoot, 'guides', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'empty-folder'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Root\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'guides', 'setup.md'), '# Setup\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'guides', 'deep', 'note.md'), '# Deep Note\n', 'utf8');

  const executablePath = process.env.DOCPILOT_ELECTRON_EXECUTABLE || '';
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ['.'] }),
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_USER_DATA_DIR: userData,
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
    editor.on('pageerror', error => {
      console.error('renderer pageerror:', error.stack || error.message || String(error));
    });
    editor.on('console', message => {
      if (message.type() === 'error') console.error('renderer console error:', message.text());
    });
    editor.on('response', async response => {
      if (response.url().includes('/file-delete') && response.status() >= 400) {
        console.error('file-delete response:', response.status(), await response.text().catch(() => ''));
      }
    });
    await editor.waitForSelector('.workspace-sidebar');
    if (await editor.locator('.release-notice-overlay').count()) {
      await editor.locator('.release-notice-modal footer button').click();
      await editor.waitForFunction(() => !document.querySelector('.release-notice-overlay'));
    }
    await editor.waitForSelector('.workspace-tree-search');
    await editor.waitForSelector('.workspace-folder-row');
    await editor.waitForSelector('.workspace-file-row');
    await editor.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.workspace-folder-row .tree-name'))
        .some(node => node.textContent?.trim() === 'guides');
    });

    const folderNames = await editor.locator('.workspace-folder-row .tree-name').allInnerTexts();
    if (!folderNames.includes('guides')) {
      throw new Error(`expected guides folder in tree, got: ${folderNames.join(', ')}`);
    }
    if (folderNames.includes('empty-folder')) {
      throw new Error(`folders without document files should stay hidden in the tree, got: ${folderNames.join(', ')}`);
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
    await editor.locator('.document-markdown-content').click();
    await editor.keyboard.type('\nUnsaved folder marker');
    await editor.waitForFunction(() => {
      const dirtyFolders = Array.from(document.querySelectorAll('.workspace-folder-row'))
        .filter(row => row.querySelector('.folder-status'))
        .map(row => row.textContent || '');
      return !dirtyFolders.some(text => text.includes('guides')) && !dirtyFolders.some(text => text.includes('deep'));
    });

    await editor.locator('.workspace-tree-search').fill('');
    await editor.locator('.workspace-folder-row').filter({ hasText: 'guides' }).first().click();
    await editor.waitForFunction(() => {
      const dirtyFolders = Array.from(document.querySelectorAll('.workspace-folder-row'))
        .filter(row => row.querySelector('.folder-status'))
        .map(row => row.textContent || '');
      return dirtyFolders.some(text => text.includes('guides'));
    });
    await editor.locator('.workspace-folder-row').filter({ hasText: 'guides' }).first().click({ button: 'right' });
    await editor.locator('.tree-context-menu button').filter({ hasText: '파일 만들기' }).click();
    await waitForPath(
      () => fs.existsSync(path.join(fixtureRoot, 'guides', 'untitled.md')),
      () => `new file should be created with an automatic temporary name before rename; files=${listFixtureFiles(fixtureRoot).join(', ')}`
    );
    await submitInlineTreeEdit(editor, 'created-by-menu.md');
    await waitForPath(
      () => fs.existsSync(path.join(fixtureRoot, 'guides', 'created-by-menu.md')),
      () => `new file should be renamed from the inline tree input; files=${listFixtureFiles(fixtureRoot).join(', ')}`
    );
    await editor.waitForFunction(() => window.document.body.innerText.includes('created-by-menu.md'));
    if (!fs.existsSync(path.join(fixtureRoot, 'guides', 'created-by-menu.md'))) {
      throw new Error('tree context menu should create a temporary file and rename it on disk');
    }
    if (fs.existsSync(path.join(fixtureRoot, 'guides', 'untitled.md'))) {
      throw new Error('temporary new file should be renamed after the prompt is submitted');
    }

    await editor.locator('.workspace-file-row').filter({ hasText: 'created-by-menu.md' }).first().click({ button: 'right' });
    await editor.locator('.tree-context-menu button').filter({ hasText: '이름 바꾸기' }).click();
    await submitInlineTreeEdit(editor, 'renamed-by-menu.md');
    await editor.waitForFunction(root => {
      return window.document.body.innerText.includes('renamed-by-menu.md') && !window.document.body.innerText.includes('created-by-menu.md');
    }, fixtureRoot);
    if (!fs.existsSync(path.join(fixtureRoot, 'guides', 'renamed-by-menu.md'))) {
      throw new Error('Enter on a selected tree file should rename it on disk');
    }

    await editor.locator('.workspace-file-row').filter({ hasText: 'renamed-by-menu.md' }).first().click({ button: 'right' });
    await editor.locator('.tree-context-menu button').filter({ hasText: '파일 삭제' }).click();
    await waitForPath(
      () => !fs.existsSync(path.join(fixtureRoot, 'guides', 'renamed-by-menu.md')) && fs.existsSync(trashRoot),
      async () => {
        const bodyText = await editor.evaluate(() => document.body.innerText);
        return `deleted file should disappear and trash directory should exist; files=${listFixtureFiles(fixtureRoot).join(', ')}; body=${bodyText.slice(0, 1000)}`;
      },
    );
    const trashedFiles = fs.readdirSync(trashRoot, { recursive: true });
    if (!trashedFiles.some(file => String(file).endsWith('renamed-by-menu.md'))) {
      throw new Error(`deleted file should move to recoverable trash, got ${trashedFiles.join(', ')}`);
    }

    const resolvedGuidePath = await editor.evaluate(async () => {
      const params = new URLSearchParams(window.location.search);
      const port = params.get('port') || '7474';
      const token = params.get('token') || '';
      const response = await fetch(`http://localhost:${port}/file-path?id=${encodeURIComponent('guides')}`, {
        headers: { 'X-DocPilot-Token': token },
      });
      return response.json();
    });
    if (resolvedGuidePath.path !== path.join(fs.realpathSync(fixtureRoot), 'guides')) {
      throw new Error(`folder path copy API should resolve absolute paths, got ${resolvedGuidePath.path}`);
    }

    await editor.locator('.workspace-folder-row').filter({ hasText: 'guides' }).first().click({ button: 'right' });
    await editor.locator('.tree-context-menu button').filter({ hasText: '파일 만들기' }).click();
    await waitForPath(
      () => fs.existsSync(path.join(fixtureRoot, 'guides', 'untitled.md')),
      () => `cancelled new file should first create a temporary file; files=${listFixtureFiles(fixtureRoot).join(', ')}`,
    );
    await cancelInlineTreeEdit(editor);
    await waitForPath(
      () => !fs.existsSync(path.join(fixtureRoot, 'guides', 'untitled.md')),
      () => `cancelled new file should be removed from disk; files=${listFixtureFiles(fixtureRoot).join(', ')}`,
    );

    await editor.locator('.workspace-tree').evaluate(element => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(160, rect.width - 12),
        clientY: rect.bottom - 8,
      }));
    });
    await editor.locator('.tree-context-menu button').filter({ hasText: /^파일 만들기$/ }).click();
    await waitForPath(
      () => fs.existsSync(path.join(fixtureRoot, 'untitled.md')),
      () => `root new file should be created with an automatic temporary name before rename; files=${listFixtureFiles(fixtureRoot).join(', ')}`,
    );
    await submitInlineTreeEdit(editor, 'empty-created.md');
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
    await editor.locator('.tree-context-menu button').filter({ hasText: '폴더 만들기' }).click();
    await waitForPath(
      () => fs.existsSync(path.join(fixtureRoot, 'new-folder', 'edit-me.md')),
      () => `cancelled new folder should first create a temporary starter document; files=${listFixtureFiles(fixtureRoot).join(', ')}`,
    );
    await cancelInlineTreeEdit(editor);
    await waitForPath(
      () => !fs.existsSync(path.join(fixtureRoot, 'new-folder')),
      () => `cancelled new folder should be removed from disk; files=${listFixtureFiles(fixtureRoot).join(', ')}`,
    );

    await editor.locator('.workspace-tree').evaluate(element => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(160, rect.width - 12),
        clientY: rect.bottom - 8,
      }));
    });
    await editor.locator('.tree-context-menu button').filter({ hasText: '폴더 만들기' }).click();
    await submitInlineTreeEdit(editor, 'project-notes');
    if (!fs.statSync(path.join(fixtureRoot, 'project-notes')).isDirectory()) {
      throw new Error('empty tree context menu should create a folder at workspace root');
    }
    if (!fs.existsSync(path.join(fixtureRoot, 'project-notes', 'edit-me.md'))) {
      throw new Error('new folders should receive an editable starter example document');
    }
    await editor.waitForFunction(() => window.document.body.innerText.includes('project-notes'));
    if (!(await editor.locator('.workspace-folder-row').filter({ hasText: 'project-notes' }).count())) {
      throw new Error('new folders should remain visible after creation');
    }

    await editor.locator('.workspace-folder-row').filter({ hasText: 'project-notes' }).first().click({ button: 'right' });
    await editor.locator('.tree-context-menu button').filter({ hasText: '폴더 삭제' }).click();
    await waitForPath(
      () => !fs.existsSync(path.join(fixtureRoot, 'project-notes')) && fs.existsSync(trashRoot),
      () => `folder delete should remove the folder and keep it recoverable; files=${listFixtureFiles(fixtureRoot).join(', ')}`,
    );

    await editor.locator('.workspace-file-row[title="README.md"]').first().click();
    await editor.locator('.editor-mode-toggle button').filter({ hasText: 'Agent Copy' }).click();
    await editor.waitForSelector('.markdown-preview h1');
    const fileRowShape = await editor.locator('.workspace-file-row[title="README.md"]').first().evaluate(row => {
      const name = row.querySelector('.tree-name');
      const icon = row.querySelector('.tree-icon-file');
      const rowRect = row.getBoundingClientRect();
      const nameRect = name?.getBoundingClientRect();
      const iconRect = icon?.getBoundingClientRect();
      return {
        rowText: row.textContent || '',
        nameText: name?.textContent || '',
        rowWidth: rowRect.width,
        nameWidth: nameRect?.width || 0,
        iconWidth: iconRect?.width || 0,
        columnCount: getComputedStyle(row).gridTemplateColumns.split(' ').length,
      };
    });
    if (fileRowShape.nameText !== 'README.md' || fileRowShape.nameWidth < 72 || fileRowShape.iconWidth < 12 || fileRowShape.columnCount < 3) {
      throw new Error(`file tree names should be readable and have a stable icon column: ${JSON.stringify(fileRowShape)}`);
    }
    await editor.locator('.editor-more-menu summary').click();
    await editor.getByRole('button', { name: 'Select all' }).click();
    await editor.getByRole('button', { name: 'Copy all' }).click();
    const copied = await readClipboard(app);
    if (!copied.includes('# Root')) {
      throw new Error(`whole-document copy should write the selected document text, got: ${copied}`);
    }
    const topbarShape = await editor.locator('.preview-width-control').evaluate(control => ({
      text: control.textContent || '',
      width: control.getBoundingClientRect().width,
      whiteSpace: getComputedStyle(control.querySelector('span')).whiteSpace,
    }));
    if (!topbarShape.text.includes('Width') || topbarShape.width < 180 || topbarShape.whiteSpace !== 'nowrap') {
      throw new Error(`preview width control should be readable and stable: ${JSON.stringify(topbarShape)}`);
    }

    console.log(`${executablePath ? 'packaged ' : ''}react workspace tree checks passed`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
