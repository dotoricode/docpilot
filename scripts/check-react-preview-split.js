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

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-split-'));
  const longBody = Array.from({ length: 60 }, (_, index) => `Paragraph ${index + 1}: preview scrolling should work from the whole center panel.`).join('\n\n');
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), `# Primary File\n\n${longBody}\n`, 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'SECOND.md'), `# Secondary File\n\n${longBody}\n`, 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'THIRD.md'), `# Third File\n\n${longBody}\n`, 'utf8');

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
    await start.evaluate(root => {
      window.localStorage.setItem('docpilot:preview-line-numbers-v2', '1');
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
    await editor.getByRole('button', { name: 'Agent Copy' }).click();
    await editor.waitForSelector('.markdown-preview.agent-copy-active');

    const palette = await editor.locator('.preview-shell').evaluate(shell => {
      const toc = shell.querySelector('.toc-rail');
      return {
        shellBackground: getComputedStyle(shell).backgroundColor,
        tocBackground: toc ? getComputedStyle(toc).backgroundColor : '',
      };
    });
    if (!palette.shellBackground || !palette.tocBackground || palette.shellBackground === 'rgba(0, 0, 0, 0)' || palette.tocBackground === 'rgba(0, 0, 0, 0)') {
      throw new Error(`preview shell and toc should both render explicit theme surfaces: ${JSON.stringify(palette)}`);
    }

    await editor.locator('.workspace-file-row').filter({ hasText: 'SECOND.md' }).first().click({ button: 'right' });
    await editor.locator('.tree-context-menu button').filter({ hasText: '분할로 열기' }).click();
    await editor.waitForSelector('.preview-compare-pane.secondary .markdown-preview h1');

    const splitText = await editor.locator('.preview-compare').innerText();
    if (!splitText.includes('Primary File') || !splitText.includes('Secondary File')) {
      throw new Error(`split preview should show both files, got: ${splitText.slice(0, 240)}`);
    }

    const primaryLineLabel = await editor.locator('.preview-compare-pane.primary .markdown-preview h1').first().getAttribute('data-line-label');
    if (primaryLineLabel !== '1') {
      throw new Error(`preview line labels should keep source line metadata, got: ${primaryLineLabel}`);
    }
    const splitLabelShape = await editor.locator('.preview-compare-pane.primary .markdown-preview').evaluate(preview => {
      const heading = preview.querySelector('h1');
      const lineStyle = heading ? getComputedStyle(heading, '::before') : null;
      return {
        lineContent: lineStyle?.content || '',
        display: lineStyle?.display || '',
      };
    });
    if (splitLabelShape.display === 'none' || !splitLabelShape.lineContent.includes('1')) {
      throw new Error(`split preview line labels should be visible when enabled while metadata remains, got: ${JSON.stringify(splitLabelShape)}`);
    }

    await editor.locator('.preview-compare-pane.secondary .markdown-preview p').first().click();
    await editor.waitForFunction(() => !document.querySelector('.preview-copy-popover'));
    await editor.waitForSelector('.preview-shell.preview-compare-active.with-context-rail .document-context-rail');
    const contextRailText = await editor.locator('.preview-shell.preview-compare-active .document-context-rail').innerText();
    if (!contextRailText.includes('참고') || !contextRailText.includes('SECOND.md')) {
      throw new Error(`split preview should show selected context chips in the right rail, got: ${contextRailText}`);
    }
    await editor.waitForSelector('.preview-copy-feedback', { state: 'visible' });
    const splitCopied = await readClipboard(app);
    if (!splitCopied.includes('File: SECOND.md') || !splitCopied.includes('Paragraph 1')) {
      throw new Error(`split preview copy should copy selected secondary text with metadata, got: ${splitCopied.slice(0, 240)}`);
    }

    await editor.locator('.preview-compare-pane.secondary').click();
    await editor.locator('.workspace-file-row').filter({ hasText: 'THIRD.md' }).first().click();
    await editor.waitForFunction(() => {
      const primary = document.querySelector('.preview-compare-pane.primary .markdown-preview h1')?.textContent?.trim();
      const secondary = document.querySelector('.preview-compare-pane.secondary .markdown-preview h1')?.textContent?.trim();
      return primary === 'Primary File' && secondary === 'Third File';
    });

    await editor.locator('.preview-compare-pane.primary').click();
    await editor.locator('.workspace-file-row').filter({ hasText: 'SECOND.md' }).first().click();
    await editor.waitForFunction(() => {
      const primary = document.querySelector('.preview-compare-pane.primary .markdown-preview h1')?.textContent?.trim();
      const secondary = document.querySelector('.preview-compare-pane.secondary .markdown-preview h1')?.textContent?.trim();
      return primary === 'Secondary File' && secondary === 'Third File';
    });

    await editor.locator('.split-preview-controls button').filter({ hasText: '상하' }).click();
    await editor.waitForSelector('.preview-compare-vertical');
    const storedVertical = await editor.evaluate(() => window.localStorage.getItem('docpilot:preview-split-orientation'));
    if (storedVertical !== 'vertical') {
      throw new Error(`split orientation should persist vertical, got: ${storedVertical}`);
    }

    await editor.locator('.split-preview-controls button').filter({ hasText: '좌우' }).click();
    await editor.waitForSelector('.preview-compare-horizontal');
    const storedHorizontal = await editor.evaluate(() => window.localStorage.getItem('docpilot:preview-split-orientation'));
    if (storedHorizontal !== 'horizontal') {
      throw new Error(`split orientation should persist horizontal, got: ${storedHorizontal}`);
    }

    const beforePrimaryHeaderWheel = await editor.locator('.preview-compare-pane .markdown-preview').evaluateAll(nodes => nodes.map(node => node.scrollTop));
    await editor.locator('.preview-compare-pane.primary header').evaluate(node => {
      node.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 360,
      }));
    });
    await editor.waitForFunction(previous => {
      const previews = Array.from(document.querySelectorAll('.preview-compare-pane .markdown-preview'));
      return previews.length === 2 && previews[0].scrollTop > previous[0];
    }, beforePrimaryHeaderWheel);
    const afterPrimaryHeaderWheel = await editor.locator('.preview-compare-pane .markdown-preview').evaluateAll(nodes => nodes.map(node => node.scrollTop));
    if (afterPrimaryHeaderWheel[1] !== beforePrimaryHeaderWheel[1]) {
      throw new Error(`primary pane header wheel should not scroll the secondary preview: ${JSON.stringify({ beforePrimaryHeaderWheel, afterPrimaryHeaderWheel })}`);
    }

    const beforeSecondaryHeaderWheel = await editor.locator('.preview-compare-pane .markdown-preview').evaluateAll(nodes => nodes.map(node => node.scrollTop));
    await editor.locator('.preview-compare-pane.secondary header').evaluate(node => {
      node.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 360,
      }));
    });
    await editor.waitForFunction(previous => {
      const previews = Array.from(document.querySelectorAll('.preview-compare-pane .markdown-preview'));
      return previews.length === 2 && previews[1].scrollTop > previous[1];
    }, beforeSecondaryHeaderWheel);
    const afterSecondaryHeaderWheel = await editor.locator('.preview-compare-pane .markdown-preview').evaluateAll(nodes => nodes.map(node => node.scrollTop));
    if (afterSecondaryHeaderWheel[0] !== beforeSecondaryHeaderWheel[0]) {
      throw new Error(`secondary pane header wheel should not scroll the primary preview: ${JSON.stringify({ beforeSecondaryHeaderWheel, afterSecondaryHeaderWheel })}`);
    }

    await editor.locator('.preview-compare-pane.secondary').click();
    await editor.locator('.split-preview-controls button').filter({ hasText: '문서 분할 닫기' }).click();
    await editor.waitForFunction(() => !document.querySelector('.preview-compare'));
    const primaryTitle = await editor.locator('.markdown-preview h1').first().innerText();
    if (primaryTitle.trim() !== 'Third File') {
      throw new Error(`closing split with secondary active should promote the secondary preview, got: ${primaryTitle}`);
    }

    await editor.locator('.editor-more-menu summary').click();
    await editor.getByRole('button', { name: 'Select all' }).click();
    await editor.getByRole('button', { name: 'Copy all' }).click();
    const copied = await readClipboard(app);
    if (!copied.includes('File: THIRD.md') || !copied.includes('Lines: 1-') || !copied.includes('# Third File')) {
      throw new Error(`whole-document copy should include file and line metadata, got: ${copied.slice(0, 240)}`);
    }

    console.log(`${executablePath ? 'packaged ' : ''}react preview split checks passed`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
