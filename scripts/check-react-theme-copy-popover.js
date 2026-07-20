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

async function readClipboard(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

async function waitForClipboard(app, predicate, label) {
  const deadline = Date.now() + 5000;
  let value = '';
  while (Date.now() < deadline) {
    value = await readClipboard(app);
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${label} clipboard did not update, got: ${value}`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-theme-copy-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-theme-copy-user-'));
  fs.writeFileSync(
    path.join(fixtureRoot, 'README.md'),
    '# Primary File\n\nCopy target paragraph for preview popover.\n\nSecond paragraph for selection copy.\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'SECOND.md'),
    '# Secondary File\n\nSecondary pane paragraph for split copy.\n',
    'utf8',
  );
  let createdInstructionId = '';

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
      window.localStorage.setItem('docpilot:left-panel-collapsed', '0');
      window.localStorage.setItem('docpilot:right-panel-collapsed', '0');
      window.docpilot.openFolder(root);
      return true;
    }, fixtureRoot);

    const editor = await waitForReactEditorWindow(app);
    await editor.waitForSelector('.workspace-sidebar');
    const releaseNotice = editor.locator('.release-notice-overlay');
    if (await releaseNotice.count()) {
      await releaseNotice.locator('button').filter({ hasText: '확인' }).click();
    }
    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await editor.waitForSelector('.markdown-preview h1');

    const topbarText = await editor.locator('.topbar-right').innerText();
    if (topbarText.includes('Claude 사용 가능') || topbarText.includes('Codex 사용 가능')) {
      throw new Error(`agent availability should not be visible in the top bar: ${topbarText}`);
    }
    const fullTopbarText = await editor.locator('.app-topbar').innerText();
    if (/\bv\d+\.\d+\.\d+\b/.test(fullTopbarText)) {
      throw new Error(`app version should not be visible in the top bar: ${fullTopbarText}`);
    }
    if (fullTopbarText.includes('Agent 세션')) {
      throw new Error(`agent session entry should be hidden while AI features are disabled: ${fullTopbarText}`);
    }
    const agentPanelCount = await editor.locator('.agent-panel, .agent-panel-disabled').count();
    if (agentPanelCount !== 0) {
      throw new Error(`right AI panel should be removed while AI features are disabled, got ${agentPanelCount} panel nodes`);
    }

    await editor.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await editor.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    const lightPalette = await editor.locator('.app-shell').evaluate(node => getComputedStyle(node).backgroundColor);
    await editor.locator('.theme-toggle button').filter({ hasText: 'Dark' }).click();
    await editor.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    const darkPalette = await editor.locator('.app-shell').evaluate(node => getComputedStyle(node).backgroundColor);
    if (lightPalette === darkPalette) {
      throw new Error(`theme toggle should change computed colors: ${JSON.stringify({ lightPalette, darkPalette })}`);
    }
    await editor.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await editor.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    const lightSurface = await editor.evaluate(() => {
      const previewShell = document.querySelector('.preview-shell');
      const toc = document.querySelector('.toc-rail');
      const sidebar = document.querySelector('.workspace-sidebar');
      return {
        rootTheme: document.documentElement.dataset.theme,
        shell: previewShell ? getComputedStyle(previewShell).backgroundColor : '',
        toc: toc ? getComputedStyle(toc).backgroundColor : '',
        sidebar: sidebar ? getComputedStyle(sidebar).backgroundColor : '',
        body: document.body.innerText,
      };
    });
    if (
      lightSurface.rootTheme !== 'light'
      || lightSurface.shell.includes('17, 19, 21')
      || lightSurface.toc.includes('17, 19, 21')
      || lightSurface.sidebar.includes('8, 9, 11')
    ) {
      throw new Error(`light mode should use warm light surfaces, got: ${JSON.stringify(lightSurface)}`);
    }
    const folderCounts = await editor.locator('.workspace-folder-row small').count();
    if (folderCounts) {
      throw new Error('folder rows should not render file count badges');
    }

    await editor.locator('.editor-mode-toggle button').filter({ hasText: 'Source' }).click();
    await editor.locator('.cm-content').click();
    await editor.keyboard.press('End');
    await editor.keyboard.type('\nUnsaved dirty marker');
    await editor.waitForSelector('.workspace-file-row.active .file-status.modified');
    const dirtyMarker = await editor.locator('.workspace-file-row.active .file-status.modified').evaluate(node => ({
      label: node.getAttribute('aria-label'),
      text: node.textContent || '',
      width: getComputedStyle(node).width,
      height: getComputedStyle(node).height,
      background: getComputedStyle(node).backgroundColor,
    }));
    if (dirtyMarker.label !== '저장 안 됨' || dirtyMarker.text.trim() || Number.parseFloat(dirtyMarker.width) > 10 || Number.parseFloat(dirtyMarker.height) > 10) {
      throw new Error(`dirty file marker should be a small filled dot without text: ${JSON.stringify(dirtyMarker)}`);
    }
    const newDot = await editor.evaluate(() => {
      const sample = document.createElement('small');
      sample.className = 'file-status new';
      sample.setAttribute('aria-label', '새 파일');
      document.body.appendChild(sample);
      const result = {
        background: getComputedStyle(sample).backgroundColor,
        text: sample.textContent || '',
        width: getComputedStyle(sample).width,
        height: getComputedStyle(sample).height,
      };
      sample.remove();
      return result;
    });
    if (newDot.text.trim() || newDot.background === dirtyMarker.background) {
      throw new Error(`new file marker should be a textless blue dot distinct from modified, got: ${JSON.stringify({ dirtyMarker, newDot })}`);
    }
    await editor.getByRole('button', { name: 'Document', exact: true }).click();
    await editor.locator('.editor-mode-toggle button').filter({ hasText: 'Agent Copy' }).click();
    await editor.waitForSelector('.markdown-preview h1');

    createdInstructionId = await editor.evaluate(async () => {
      const params = new URLSearchParams(window.location.search);
      const port = params.get('port') || '7474';
      const token = params.get('token') || '';
      const response = await fetch(`http://localhost:${port}/instructions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'X-DocPilot-Token': token } : {}) },
        body: JSON.stringify({
          title: 'copy check instruction',
          body: '복사된 내용은 활성 지침을 우선 반영한다.',
          sourceRef: 'docs/instructions/copy-check.md',
          active: true,
        }),
      });
      const data = await response.json();
      return data.instruction?.id || '';
    });

    const headingText = await editor.locator('.markdown-preview h1').first().innerText();
    if (headingText.trim() !== 'Primary File') {
      throw new Error(`line label should not be included in heading text, got: ${headingText}`);
    }
    const lineShape = await editor.locator('.markdown-preview').evaluate(preview => {
      const heading = preview.querySelector('h1');
      const lineStyle = heading ? getComputedStyle(heading, '::before') : null;
      return {
        content: lineStyle?.content || '',
        display: lineStyle?.display || '',
      };
    });
    if (lineShape.display !== 'none') {
      throw new Error(`preview line labels should be hidden by default: ${JSON.stringify(lineShape)}`);
    }
    const lineNumberToggle = editor.locator('.line-number-toggle');
    if (!await lineNumberToggle.isVisible() || await lineNumberToggle.locator('xpath=ancestor::details').count()) {
      throw new Error('preview line-number toggle should be visible outside the More menu');
    }
    await lineNumberToggle.click();
    const visibleLineShape = await editor.locator('.markdown-preview').evaluate(preview => {
      const heading = preview.querySelector('h1');
      const lineStyle = heading ? getComputedStyle(heading, '::before') : null;
      return {
        content: lineStyle?.content || '',
        display: lineStyle?.display || '',
      };
    });
    if (visibleLineShape.display === 'none' || !visibleLineShape.content.includes('1')) {
      throw new Error(`preview line labels should show when toggled on: ${JSON.stringify(visibleLineShape)}`);
    }
    await lineNumberToggle.click();
    const hiddenLineShape = await editor.locator('.markdown-preview').evaluate(preview => {
      const heading = preview.querySelector('h1');
      const lineStyle = heading ? getComputedStyle(heading, '::before') : null;
      return {
        content: lineStyle?.content || '',
        display: lineStyle?.display || '',
      };
    });
    if (hiddenLineShape.display !== 'none') {
      throw new Error(`preview line labels should hide when toggled off: ${JSON.stringify(hiddenLineShape)}`);
    }
    await editor.locator('.editor-title').click();

    await editor.locator('.markdown-preview h1').first().click();
    await editor.waitForFunction(() => !document.querySelector('.preview-copy-popover'));
    const copiedLocation = await waitForClipboard(app, text => text.includes('File: README.md') && text.includes('Lines: 1'), 'current target copy');
    if (!copiedLocation.includes('File: README.md') || !copiedLocation.includes('Lines: 1') || !copiedLocation.includes('Primary File')) {
      throw new Error(`target copy should include file, line metadata, and block text, got: ${copiedLocation}`);
    }
    if (
      copiedLocation.includes('활성화된 DocPilot 지침이 있습니다.')
      || !copiedLocation.includes('DocPilot 활성 지침')
      || !copiedLocation.includes('- copy check instruction (docs/instructions/copy-check.md)')
    ) {
      throw new Error(`copy should include active-instruction prompt when instructions are active, got: ${copiedLocation}`);
    }

    await editor.locator('.markdown-preview p').filter({ hasText: 'Copy target paragraph' }).first().click();
    await editor.waitForFunction(() => !document.querySelector('.preview-copy-popover'));
    const copiedParagraph = await waitForClipboard(app, text => text.includes('Copy target paragraph for preview popover.'), 'preview copy');
    if (
      !copiedParagraph.includes('File: README.md')
      || !copiedParagraph.includes('Lines: 3')
      || !copiedParagraph.includes('Copy target paragraph for preview popover.')
    ) {
      throw new Error(`preview copy should include clicked block metadata and text, got: ${copiedParagraph}`);
    }
    if (copiedParagraph.includes('활성화된 DocPilot 지침이 있습니다.') || !copiedParagraph.includes('docs/instructions/copy-check.md')) {
      throw new Error(`preview copy should include improved instruction reference, got: ${copiedParagraph}`);
    }

    await editor.locator('.markdown-preview p').filter({ hasText: 'Second paragraph' }).first().evaluate(node => {
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = Array.from(node.childNodes).find(child => child.nodeType === Node.TEXT_NODE);
      if (!selection || !textNode) throw new Error('selection setup failed');
      range.setStart(textNode, 0);
      range.setEnd(textNode, 'Second paragraph'.length);
      selection.removeAllRanges();
      selection.addRange(range);
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 220, clientY: 220 }));
    });
    await editor.waitForSelector('.preview-copy-popover');
    const closeButtonCount = await editor.locator('.preview-copy-popover .preview-copy-close').count();
    if (closeButtonCount !== 0) {
      throw new Error('preview selection popover should not render a close X button');
    }
    await editor.locator('.preview-copy-popover button').filter({ hasText: /^복사$/ }).click();
    const copiedSelection = await waitForClipboard(app, text => text.includes('Second paragraph'), 'selection copy');
    if (
      copiedSelection.includes('활성화된 DocPilot 지침이 있습니다.')
      || !copiedSelection.includes('docs/instructions/copy-check.md')
      || !copiedSelection.includes('File: README.md')
      || !copiedSelection.includes('Lines:')
      || !copiedSelection.includes('Second paragraph')
    ) {
      throw new Error(`drag/selection copy should include selected metadata and text, got: ${copiedSelection}`);
    }

    await editor.locator('.markdown-preview p').filter({ hasText: 'Copy target paragraph' }).first().evaluate(node => {
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = Array.from(node.childNodes).find(child => child.nodeType === Node.TEXT_NODE);
      if (!selection || !textNode) throw new Error('selection setup failed');
      range.setStart(textNode, 0);
      range.setEnd(textNode, 'Copy target paragraph'.length);
      selection.removeAllRanges();
      selection.addRange(range);
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 240, clientY: 240 }));
    });
    await editor.waitForSelector('.preview-copy-popover');
    await editor.locator('.preview-copy-popover button').filter({ hasText: '선택 내용 전체 복사' }).click();
    const copiedAllSelected = await waitForClipboard(app, text => text.includes('File: README.md') && text.includes('Copy target paragraph for preview popover.'), 'all selected copy');
    const paragraphOccurrences = copiedAllSelected.split('Copy target paragraph for preview popover.').length - 1;
    if (
      copiedAllSelected.includes('활성화된 DocPilot 지침이 있습니다.')
      || !copiedAllSelected.includes('docs/instructions/copy-check.md')
      || !copiedAllSelected.includes('File: README.md')
      || !copiedAllSelected.includes('Lines:')
      || paragraphOccurrences !== 1
    ) {
      throw new Error(`all selected copy should include deduplicated metadata and text, got: ${copiedAllSelected}`);
    }

    await editor.locator('.workspace-file-row').filter({ hasText: 'SECOND.md' }).first().click({ button: 'right' });
    await editor.locator('.tree-context-menu button').filter({ hasText: '분할로 열기' }).click();
    await editor.waitForSelector('.preview-compare-pane.secondary .markdown-preview h1');
    await editor.locator('.preview-compare-pane.secondary .markdown-preview p').first().click();
    await editor.waitForFunction(() => !document.querySelector('.preview-copy-popover'));
    const copiedSplitLocation = await waitForClipboard(app, text => text.includes('File: SECOND.md') && text.includes('Lines: 3'), 'split location copy');
    if (!copiedSplitLocation.includes('File: SECOND.md') || !copiedSplitLocation.includes('Lines: 3') || !copiedSplitLocation.includes('Secondary pane paragraph')) {
      throw new Error(`split copy should use secondary pane metadata and text, got: ${copiedSplitLocation}`);
    }
    if (copiedSplitLocation.includes('활성화된 DocPilot 지침이 있습니다.') || !copiedSplitLocation.includes('docs/instructions/copy-check.md')) {
      throw new Error(`split location copy should include active-instruction prompt, got: ${copiedSplitLocation}`);
    }

    if (createdInstructionId) {
      await editor.evaluate(async id => {
        const params = new URLSearchParams(window.location.search);
        const port = params.get('port') || '7474';
        const token = params.get('token') || '';
        await fetch(`http://localhost:${port}/instructions/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'X-DocPilot-Token': token } : {}) },
          body: JSON.stringify({ id }),
        });
      }, createdInstructionId);
      createdInstructionId = '';
    }

    console.log(`${executablePath ? 'packaged ' : ''}react theme and preview copy checks passed`);
  } finally {
    if (createdInstructionId) {
      for (const win of app.windows()) {
        try {
          await win.evaluate(async id => {
            const params = new URLSearchParams(window.location.search);
            const port = params.get('port') || '7474';
            const token = params.get('token') || '';
            await fetch(`http://localhost:${port}/instructions/delete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { 'X-DocPilot-Token': token } : {}) },
              body: JSON.stringify({ id }),
            });
          }, createdInstructionId);
          break;
        } catch {}
      }
    }
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
