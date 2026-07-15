const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

async function waitForEditorWindow(app) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const window = app.windows().find(item => item.url().includes('dist/renderer/index.html'));
    if (window) return window;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('DocPilot editor window did not open');
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

async function dismissReleaseNotice(page) {
  const notice = page.locator('.release-notice-overlay');
  if (await notice.isVisible().catch(() => false)) await notice.click({ position: { x: 8, y: 8 } });
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-orca-regressions-'));
  const sections = Array.from({ length: 36 }, (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}.`).join('\n\n');
  fs.writeFileSync(path.join(fixture, 'tracked.md'), `# Tracked\n\n${sections}\n`, 'utf8');
  git(fixture, ['init', '-q']);
  git(fixture, ['config', 'user.email', 'qa@docpilot.local']);
  git(fixture, ['config', 'user.name', 'DocPilot QA']);
  git(fixture, ['add', 'tracked.md']);
  git(fixture, ['commit', '-qm', 'fixture baseline']);
  fs.writeFileSync(path.join(fixture, 'new.md'), `# New document\n\n${sections}\n`, 'utf8');

  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const app = await electron.launch({ args: ['.', fixture], cwd: root });

  try {
    const page = await waitForEditorWindow(app);
    await page.waitForSelector('.workspace-file-row');
    await dismissReleaseNotice(page);
    await page.evaluate(() => localStorage.setItem('docpilot:terminal-open', 'true'));
    await page.reload();
    await page.waitForSelector('.workspace-file-row');
    await dismissReleaseNotice(page);
    await page.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');

    const topbarGeometry = await page.evaluate(() => {
      const topbar = document.querySelector('.app-topbar')?.getBoundingClientRect();
      const logo = document.querySelector('.app-logo')?.getBoundingClientRect();
      return { topbar, logo };
    });
    check(Boolean(topbarGeometry.topbar && topbarGeometry.logo), 'topbar geometry is unavailable');
    if (topbarGeometry.topbar && topbarGeometry.logo) {
      const topbarCenter = topbarGeometry.topbar.top + topbarGeometry.topbar.height / 2;
      const logoCenter = topbarGeometry.logo.top + topbarGeometry.logo.height / 2;
      check(Math.abs(topbarCenter - logoCenter) <= 1, 'DocPilot topbar label is not vertically centered');
      check(topbarGeometry.logo.left >= 108, `DocPilot label is too close to macOS window controls: ${topbarGeometry.logo.left}px`);
    }
    const artifacts = path.join(root, '.tink', 'current', 'artifacts');
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({
      path: path.join(artifacts, 'topbar-logo-offset-light.png'),
      clip: { x: 0, y: 0, width: 360, height: 120 },
      scale: 'css',
    });

    await page.locator('.workspace-file-row').filter({ hasText: 'tracked.md' }).click();
    await page.waitForSelector('.editor-mode-toggle');
    if (!await page.locator('.terminal-pane').isVisible().catch(() => false)) {
      await page.getByLabel('Open terminal pane').first().click();
      await page.waitForSelector('.terminal-pane');
    }

    const terminalSurface = await page.evaluate(() => {
      const host = document.querySelector('.terminal-xterm-host');
      const xterm = document.querySelector('.terminal-xterm-host .xterm');
      const hostStyle = host ? getComputedStyle(host) : null;
      const xtermStyle = xterm ? getComputedStyle(xterm) : null;
      return {
        hostBackground: hostStyle?.backgroundColor,
        xtermBackground: xtermStyle?.backgroundColor,
        paddingTop: Number.parseFloat(hostStyle?.paddingTop || '99'),
      };
    });
    check(terminalSurface.paddingTop <= 4, `light terminal has excessive inset: ${terminalSurface.paddingTop}px`);
    check(terminalSurface.hostBackground === terminalSurface.xtermBackground, `light terminal surfaces disagree: ${terminalSurface.hostBackground} vs ${terminalSurface.xtermBackground}`);

    const connectedDot = await page.locator('.bridge-status.connected .bridge-dot').evaluate(node => getComputedStyle(node).backgroundColor);
    check(connectedDot === 'rgb(34, 197, 94)' || connectedDot === 'rgb(40, 183, 112)', `connected status dot is not green: ${connectedDot}`);

    const collapseButton = page.locator('.workspace-title .panel-title-actions button:last-child');
    check(await collapseButton.getAttribute('aria-label') === 'Collapse project panel', 'Project panel collapse control has no clear accessible label');
    await collapseButton.click();
    const collapsedBackground = await page.locator('.panel-collapsed-rail.left-rail').evaluate(node => getComputedStyle(node).backgroundColor);
    check(collapsedBackground !== 'rgb(0, 0, 0)' && collapsedBackground !== 'rgb(7, 8, 10)', `light collapsed rail stays dark: ${collapsedBackground}`);
    await page.locator('.panel-rail-open-button').click();

    await page.getByRole('region', { name: 'Terminal sessions' }).getByLabel('Close terminal pane').click();
    check(await page.locator('.terminal-reopen-button').isVisible().catch(() => false), 'Terminal cannot be reopened from the workbench after closing');

    await page.locator('.editor-mode-toggle button').filter({ hasText: 'Source' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.type('\nAdded from regression test.');
    await page.getByRole('checkbox', { name: 'Diff' }).click();
    await page.waitForSelector('.raw-diff-line');
    const rawVisible = await page.locator('.raw-diff-lines').evaluate(node => {
      const rect = node.getBoundingClientRect();
      return rect.height > 40 && node.scrollHeight > 40;
    });
    check(rawVisible, 'Source diff content is clipped or invisible');
    await page.locator('.diff-toggle').filter({ hasText: '좌우 비교' }).locator('input').click();
    const rawSplitVisible = await page.locator('.raw-diff-split').evaluate(node => {
      const panes = [...node.querySelectorAll('.raw-diff-lines')];
      return panes.length === 2 && panes.every(item => item.getBoundingClientRect().width > 120 && item.getBoundingClientRect().height > 40);
    });
    check(rawSplitVisible, 'Source side-by-side diff panes are clipped or invisible');

    await page.locator('.diff-toggle').filter({ hasText: '좌우 비교' }).locator('input').click();
    await page.locator('.editor-mode-toggle button').filter({ hasText: 'Preview' }).click();
    await page.waitForSelector('.preview-diff-block');
    const previewScrolls = await page.locator('.markdown-preview').evaluate(node => {
      const before = node.scrollTop;
      node.scrollTop = Math.min(160, node.scrollHeight);
      return node.scrollHeight > node.clientHeight && node.scrollTop > before;
    });
    check(previewScrolls, 'Preview diff does not scroll inside the document canvas');

    await page.locator('.workspace-file-row').filter({ hasText: 'new.md' }).click();
    await page.locator('.editor-mode-toggle button').filter({ hasText: 'Preview' }).click();
    const diffCheckbox = page.getByRole('checkbox', { name: 'Diff' });
    if (!(await diffCheckbox.isChecked())) await diffCheckbox.click();
    await page.waitForSelector('.diff-change-list button');
    const changeCards = await page.locator('.diff-change-list button').count();
    check(changeCards === 1, `contiguous all-added document creates ${changeCards} change cards instead of one hunk`);

    if (failures.length) throw new Error(`Orca workbench regressions:\n- ${failures.join('\n- ')}`);
    console.log('orca workbench regression checks passed');
  } finally {
    await app.close().catch(() => {});
    try { execFileSync('pkill', ['-f', `bridge.js --root ${fixture}`]); } catch {}
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
