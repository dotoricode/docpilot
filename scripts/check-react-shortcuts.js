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

async function openFixture(editor, fixtureRoot) {
  await editor.evaluate(root => {
    window.docpilot.openFolder(root);
    return true;
  }, fixtureRoot);
}

async function pressShortcut(editor, key) {
  await editor.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-shortcuts-'));
  fs.mkdirSync(path.join(fixtureRoot, 'docs'), { recursive: true });
  const alphaBody = Array.from({ length: 70 }, (_, index) => `## Alpha Section ${index + 1}\n\nAlpha body token ${index + 1}.\n`).join('\n');
  fs.writeFileSync(path.join(fixtureRoot, 'alpha.md'), `# Alpha Title\n\n${alphaBody}`, 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'docs', 'beta.md'), '# Beta Title\n\nBeta body token.\n', 'utf8');

  const executablePath = process.env.DOCPILOT_ELECTRON_EXECUTABLE || '';
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
    await openFixture(start, fixtureRoot);

    const editor = await waitForReactEditorWindow(app);
    await app.evaluate(({ BrowserWindow }) => {
      const editorWindow = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
      editorWindow?.setSize(1280, 900);
    });
    editor.on('pageerror', error => {
      console.error('renderer pageerror:', error.stack || error.message || String(error));
    });
    editor.on('console', message => {
      if (message.type() === 'error') console.error('renderer console error:', message.text());
    });
    await editor.waitForSelector('.workspace-sidebar');
    if (await editor.locator('.release-notice-overlay').count()) {
      await editor.locator('.release-notice-modal footer button').click();
      await editor.waitForFunction(() => !document.querySelector('.release-notice-overlay'));
    }
    await editor.locator('.workspace-file-row').filter({ hasText: 'alpha.md' }).first().click();
    await editor.waitForSelector('.document-markdown-content');
    await editor.locator('.theme-toggle button').filter({ hasText: 'Dark' }).click();
    await editor.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await editor.waitForFunction(() => document.body.innerText.includes('Alpha Title'));
    await editor.waitForFunction(() => document.querySelectorAll('.file-tab').length === 1);

    await editor.getByRole('button', { name: 'Source' }).click();
    await pressShortcut(editor, 'F');
    await editor.waitForSelector('.cm-search input');
    if (await editor.locator('.preview-find-bar input').count()) {
      throw new Error('cmd+f in edit mode should not switch to preview find');
    }
    const editFindStyle = await editor.evaluate(() => {
      const panel = document.querySelector('.cm-search');
      const input = document.querySelector('.cm-search input:not([type="checkbox"])');
      if (!panel || !input) return null;
      const panelStyle = window.getComputedStyle(panel);
      const inputStyle = window.getComputedStyle(input);
      return {
        panelBackground: panelStyle.backgroundColor,
        panelColor: panelStyle.color,
        panelBorderRadius: panelStyle.borderRadius,
        inputBackground: inputStyle.backgroundColor,
        inputColor: inputStyle.color,
        inputBorderRadius: inputStyle.borderRadius,
      };
    });
    if (!editFindStyle) {
      throw new Error('edit cmd+f search panel should be present');
    }
    if (
      editFindStyle.panelBackground === 'rgb(238, 238, 238)' ||
      editFindStyle.inputBackground === 'rgb(255, 255, 255)' ||
      editFindStyle.panelColor === 'rgb(0, 0, 0)' ||
      editFindStyle.panelBorderRadius === '0px' ||
      editFindStyle.inputBorderRadius === '0px'
    ) {
      throw new Error(`edit cmd+f search panel should use DocPilot dark theme, got ${JSON.stringify(editFindStyle)}`);
    }
    const editFindText = await editor.locator('.cm-search').innerText();
    if (/replace|regexp|match case|by word|\\ball\\b/i.test(editFindText)) {
      throw new Error(`edit cmd+f should be find-only, got ${editFindText}`);
    }
    await editor.getByRole('textbox', { name: 'Find' }).click();
    await editor.waitForSelector('.cm-search');
    await editor.locator('.editor-title').click({ position: { x: 8, y: 8 } });
    await editor.waitForFunction(() => !document.querySelector('.cm-search'));
    await editor.getByRole('button', { name: 'Document', exact: true }).click();
    await editor.getByRole('button', { name: 'Agent Copy' }).click();
    await pressShortcut(editor, 'F');
    await editor.waitForSelector('.preview-find-bar input');
    const scrollBeforeFind = await editor.evaluate(() => {
      const preview = document.querySelector('.markdown-preview');
      if (!preview) return 0;
      preview.scrollTop = preview.scrollHeight;
      return preview.scrollTop;
    });
    await editor.locator('.preview-find-bar input').fill('Alpha');
    try {
      await editor.waitForFunction(() => document.querySelectorAll('.preview-find-mark').length > 0, null, { timeout: 5000 });
    } catch (err) {
      const findState = await editor.evaluate(() => ({
        input: document.querySelector('.preview-find-bar input')?.value || '',
        count: document.querySelector('.preview-find-count')?.textContent || '',
        marks: document.querySelectorAll('.preview-find-mark').length,
        previewText: document.querySelector('.markdown-preview')?.textContent?.slice(0, 200) || '',
        bodyText: document.body.innerText.slice(0, 1000),
      }));
      throw new Error(`cmd+f should highlight preview matches: ${JSON.stringify(findState)}`);
    }
    const findCount = await editor.locator('.preview-find-count').innerText();
    if (!/of/.test(findCount)) {
      throw new Error(`cmd+f should show preview match count, got ${findCount}`);
    }
    const previewFindText = await editor.locator('.preview-find-bar').innerText();
    if (/Aa|ab|\\.\\*/.test(previewFindText)) {
      throw new Error(`preview cmd+f should be find-only, got ${previewFindText}`);
    }
    const scrollAfterFind = await editor.evaluate(() => document.querySelector('.markdown-preview')?.scrollTop || 0);
    if (Math.abs(scrollAfterFind - scrollBeforeFind) > 12) {
      throw new Error(`cmd+f should preserve preview scroll while applying highlights: before=${scrollBeforeFind}, after=${scrollAfterFind}`);
    }
    await editor.locator('.markdown-preview').evaluate(node => {
      node.scrollTop = Math.max(0, node.scrollTop - 180);
    });
    const marksAfterScroll = await editor.locator('.preview-find-mark').count();
    if (marksAfterScroll === 0) {
      throw new Error('preview find marks should remain visible after scrolling');
    }
    await editor.locator('.editor-title').click({ position: { x: 8, y: 8 } });
    await editor.waitForFunction(() => !document.querySelector('.preview-find-bar'));
    await pressShortcut(editor, 'F');
    await editor.waitForSelector('.preview-find-bar input');
    await editor.locator('.preview-find-bar button').last().click();
    await editor.waitForFunction(() => !document.querySelector('.preview-find-bar'));

    await pressShortcut(editor, 'P');
    await editor.waitForSelector('.quick-open-panel input');
    await editor.locator('.quick-open-panel input').fill('beta');
    await editor.waitForFunction(() => document.body.innerText.includes('beta.md'));
    await editor.keyboard.press('Enter');
    await editor.waitForFunction(() => document.body.innerText.includes('Beta Title'));
    await editor.waitForFunction(() => document.querySelectorAll('.file-tab').length === 2);

    await pressShortcut(editor, 'W');
    await editor.waitForFunction(() => {
      const tabs = Array.from(document.querySelectorAll('.file-tab')).map(node => node.textContent || '');
      return tabs.length === 1 && tabs[0].includes('alpha.md') && document.body.innerText.includes('Alpha Title');
    });

    await pressShortcut(editor, 'P');
    await editor.waitForSelector('.quick-open-panel input');
    await editor.locator('.quick-open-panel input').fill('beta');
    await editor.keyboard.press('Enter');
    await editor.waitForFunction(() => document.body.innerText.includes('Beta Title'));

    await pressShortcut(editor, 'D');
    await editor.waitForSelector('.preview-compare-active.split-horizontal');
    await editor.waitForFunction(() => document.querySelectorAll('.split-preview-document').length === 2);
    await assertSplitResizeChanges(editor, 'horizontal');
    await editor.waitForFunction(() => {
      const primaryTabs = Array.from(document.querySelectorAll('.file-tab-pane[data-pane="primary"] .file-tab')).map(node => node.textContent || '');
      const secondaryTabs = Array.from(document.querySelectorAll('.file-tab-pane[data-pane="secondary"] .file-tab')).map(node => node.textContent || '');
      return primaryTabs.some(text => text.includes('beta.md')) && secondaryTabs.some(text => text.includes('beta.md'));
    });
    await editor.locator('.preview-compare-pane.primary').click();
    await editor.locator('.workspace-file-row').filter({ hasText: 'beta.md' }).first().click();
    await editor.waitForFunction(() => {
      const panes = Array.from(document.querySelectorAll('.preview-compare-pane header strong')).map(node => node.textContent || '');
      const primaryTabs = Array.from(document.querySelectorAll('.file-tab-pane[data-pane="primary"] .file-tab')).map(node => node.textContent || '');
      const secondaryTabs = Array.from(document.querySelectorAll('.file-tab-pane[data-pane="secondary"] .file-tab')).map(node => node.textContent || '');
      return document.querySelector('.preview-compare-active')
        && panes.filter(text => text.includes('docs/beta.md')).length === 2
        && primaryTabs.some(text => text.includes('beta.md'))
        && secondaryTabs.some(text => text.includes('beta.md'));
    });

    await pressShortcut(editor, 'Shift+D');
    await editor.waitForSelector('.preview-compare-active.split-vertical');
    await editor.waitForFunction(() => {
      const primaryPane = document.querySelector('.preview-compare-pane.primary');
      const secondaryPane = document.querySelector('.preview-compare-pane.secondary');
      const primaryTabs = document.querySelector('.file-tab-pane[data-pane="primary"]');
      const secondaryTabs = document.querySelector('.file-tab-pane[data-pane="secondary"]');
      if (!primaryPane || !secondaryPane || !primaryTabs || !secondaryTabs) return false;
      const primaryPaneRect = primaryPane.getBoundingClientRect();
      const secondaryPaneRect = secondaryPane.getBoundingClientRect();
      const primaryTabsRect = primaryTabs.getBoundingClientRect();
      const secondaryTabsRect = secondaryTabs.getBoundingClientRect();
      return primaryTabsRect.top >= primaryPaneRect.top - 1
        && secondaryTabsRect.top >= secondaryPaneRect.top - 1
        && secondaryTabsRect.top > primaryTabsRect.top;
    });
    await assertSplitResizeChanges(editor, 'vertical');

    await pressShortcut(editor, 'P');
    await editor.waitForSelector('.quick-open-panel input');
    await editor.locator('.quick-open-panel input').fill('alpha');
    await editor.waitForFunction(() => document.body.innerText.includes('alpha.md'));
    await pressShortcut(editor, 'D');
    await editor.waitForFunction(() => {
      const panes = Array.from(document.querySelectorAll('.preview-compare-pane header strong')).map(node => node.textContent || '');
      return panes.some(text => text.includes('docs/beta.md')) && panes.some(text => text.includes('alpha.md'));
    });
    await editor.waitForFunction(() => {
      const primaryTabs = Array.from(document.querySelectorAll('.file-tab-pane[data-pane="primary"] .file-tab')).map(node => node.textContent || '');
      const secondaryTabs = Array.from(document.querySelectorAll('.file-tab-pane[data-pane="secondary"] .file-tab')).map(node => node.textContent || '');
      return primaryTabs.some(text => text.includes('beta.md')) && secondaryTabs.some(text => text.includes('beta.md')) && secondaryTabs.some(text => text.includes('alpha.md'));
    });
    await editor.locator('.file-tab-pane[data-pane="secondary"] .file-tab').filter({ hasText: 'alpha.md' }).dragTo(
      editor.locator('.file-tab-pane[data-pane="secondary"] .file-tab').filter({ hasText: 'beta.md' }),
    );
    await editor.waitForFunction(() => {
      const secondaryTabs = Array.from(document.querySelectorAll('.file-tab-pane[data-pane="secondary"] .file-tab')).map(node => node.textContent || '');
      return secondaryTabs[0]?.includes('alpha.md') && secondaryTabs[1]?.includes('beta.md');
    });
    await pressShortcut(editor, 'W');
    await editor.waitForFunction(() => {
      const secondaryTabs = Array.from(document.querySelectorAll('.file-tab-pane[data-pane="secondary"] .file-tab')).map(node => node.textContent || '');
      return document.querySelector('.preview-compare-active') && secondaryTabs.length === 1 && secondaryTabs[0].includes('beta.md');
    });
    await pressShortcut(editor, 'W');
    await editor.waitForFunction(() => !document.querySelector('.preview-compare-active'));

    console.log('react shortcut checks passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function assertSplitResizeChanges(editor, orientation) {
  const before = await editor.locator('.preview-compare-pane.primary').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const resizer = editor.locator(`.preview-split-resizer-${orientation}`).first();
  const box = await resizer.boundingBox();
  if (!box) throw new Error(`split ${orientation} resizer should be visible`);
  await editor.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (orientation === 'horizontal') {
    await editor.mouse.down();
    await editor.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
    await editor.mouse.up();
  } else {
    await editor.mouse.down();
    await editor.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 70);
    await editor.mouse.up();
  }
  const after = await editor.locator('.preview-compare-pane.primary').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const changed = orientation === 'horizontal'
    ? Math.abs(after.width - before.width) > 24
    : Math.abs(after.height - before.height) > 24;
  if (!changed) {
    throw new Error(`split ${orientation} resize should change primary pane size: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
