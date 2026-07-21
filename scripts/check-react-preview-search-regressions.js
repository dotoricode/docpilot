const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function waitForEditor(app) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const page = app.windows().find(win => /(?:dist\/renderer\/index\.html|\/index\.html)$/.test(win.url().split('?')[0]));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor window did not open: ${app.windows().map(win => win.url()).join(', ')}`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-search-'));
  fs.mkdirSync(path.join(fixtureRoot, 'docs'));
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Primary\n\nCopy this exact fragment and keep it selected.\n');
  fs.writeFileSync(path.join(fixtureRoot, 'docs', 'guide.md'), '# Guide\n\nUnique repository search needle.\n');
  const app = await electron.launch({ args: ['.'], cwd: repoRoot, env: { ...process.env, DOCPILOT_FAKE_AGENT: '1' } });

  try {
    const start = await app.firstWindow();
    await start.waitForLoadState('domcontentloaded');
    await start.evaluate(root => {
      localStorage.setItem('docpilot:left-panel-collapsed', '0');
      localStorage.setItem('docpilot:terminal-open', '1');
      localStorage.removeItem('docpilot:release-notice-seen-id');
      localStorage.removeItem('docpilot:release-notice-seen-version');
      window.docpilot.openFolder(root);
    }, fixtureRoot);
    const page = await waitForEditor(app);
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.waitForSelector('.workspace-sidebar');
    const release = page.locator('.release-notice-overlay');
    if (process.env.DOCPILOT_TEST_HIDDEN_WINDOWS === '1') {
      if (await release.count()) throw new Error('quiet regression mode must suppress release notes so tests never interrupt active work');
    } else {
      if (!(await release.count())) throw new Error('release notes must appear after an unseen update');
      const releaseShape = await release.locator('.release-notice-modal').evaluate(node => ({
        width: node.getBoundingClientRect().width,
        bodyColumns: getComputedStyle(node.querySelector('.release-notice-body')).gridTemplateColumns.split(' ').length,
        brandIcons: node.querySelectorAll('.release-notice-mark svg').length,
        dotCount: node.querySelectorAll('.release-notice-dot').length,
        items: node.querySelectorAll('.release-notice-list li').length,
      }));
      if (releaseShape.width < 680 || releaseShape.width > 800 || releaseShape.bodyColumns !== 2 || releaseShape.brandIcons !== 1 || releaseShape.dotCount || releaseShape.items < 2) {
        throw new Error(`release notes must use the centered two-column launch language and icon: ${JSON.stringify(releaseShape)}`);
      }
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await release.locator('.release-notice-modal').screenshot({ path: path.join(artifactRoot, 'release-notice-light.png') });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await release.locator('.release-notice-modal').screenshot({ path: path.join(artifactRoot, 'release-notice-dark.png') });
      await release.getByRole('button', { name: '확인' }).click();
    }
    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await page.getByRole('button', { name: 'Agent Copy' }).click();
    await page.waitForSelector('.markdown-preview p');

    if (!(await page.locator('.terminal-xterm-host .xterm').count())) {
      await page.locator('.terminal-empty-primary').click();
      await page.waitForSelector('.terminal-xterm-host .xterm');
    }
    const terminalFont = await page.locator('.terminal-xterm-host .xterm').evaluate(node => getComputedStyle(node).fontFamily);
    if (!/MesloLGS NF|Nerd Font|Symbols Nerd Font/i.test(terminalFont)) {
      throw new Error(`terminal must expose a Nerd Font fallback, got: ${terminalFont}`);
    }

    await page.locator('.markdown-preview p').evaluate(node => {
      const text = node.firstChild;
      const selection = getSelection();
      if (!text || !selection) throw new Error('selection setup failed');
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 24);
      selection.removeAllRanges();
      selection.addRange(range);
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 420, clientY: 240 }));
    });
    await page.waitForSelector('.preview-copy-popover');
    const retained = await page.evaluate(() => getSelection()?.toString() || '');
    if (retained !== 'Copy this exact fragment') throw new Error(`preview selection must remain active, got: ${retained}`);
    await page.keyboard.press('Meta+c');
    await page.waitForSelector('.preview-copy-feedback');
    const feedbackShape = await page.evaluate(() => {
      const feedback = document.querySelector('.preview-copy-feedback')?.getBoundingClientRect();
      const selection = getSelection()?.rangeCount ? getSelection().getRangeAt(0).getBoundingClientRect() : null;
      return {
        distance: feedback && selection ? Math.hypot(feedback.left - selection.right, feedback.top - selection.top) : Infinity,
        feedback: feedback ? { left: feedback.left, top: feedback.top, text: document.querySelector('.preview-copy-feedback')?.textContent } : null,
        selection: selection ? { left: selection.left, right: selection.right, top: selection.top } : null,
      };
    });
    if (feedbackShape.distance > 220) throw new Error(`copy feedback must appear near selection: ${JSON.stringify(feedbackShape)}`);

    await page.locator('.editor-more-menu summary').click();
    await page.waitForSelector('.editor-more-menu[open]');
    await page.locator('.editor-title').click();
    if (await page.locator('.editor-more-menu[open]').count()) throw new Error('editor menu must close on outside click');

    await page.locator('.editor-more-menu summary').click();
    await page.evaluate(() => localStorage.setItem('docpilot:preview-width-explicit-v1', '1'));
    const widthInput = page.locator('.preview-width-control input');
    await widthInput.evaluate(input => {
      input.value = '480';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('.preview-width-control span')?.textContent?.includes('480'));
    const previewWidth = await page.locator('.markdown-preview').evaluate(node => node.getBoundingClientRect().width);
    if (previewWidth < 470 || previewWidth > 490) throw new Error(`preview width must apply to rendered document, got: ${previewWidth}`);

    await page.keyboard.press('Meta+Shift+f');
    await page.waitForSelector('.project-search-panel');
    const search = page.locator('.project-search-input');
    await search.fill('Unique repository search needle');
    await page.waitForSelector('.project-search-result');
    const resultText = await page.locator('.project-search-result').first().innerText();
    if (!resultText.includes('docs/guide.md') || !resultText.includes('Unique repository search needle')) {
      throw new Error(`repository content search must show matching file and excerpt, got: ${resultText}`);
    }
    await page.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.locator('.project-search-panel').screenshot({ path: path.join(artifactRoot, 'project-search-light.png') });
    await page.screenshot({ path: path.join(artifactRoot, 'project-search-workbench-light.png') });
    await page.locator('.theme-toggle button').filter({ hasText: 'Dark' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.locator('.project-search-panel').screenshot({ path: path.join(artifactRoot, 'project-search-dark.png') });

    console.log('react preview/search regression checks passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
