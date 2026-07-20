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

async function dismissReleaseNotice(page) {
  const notice = page.locator('.release-notice-overlay');
  if (await notice.isVisible().catch(() => false)) await notice.click({ position: { x: 8, y: 8 } });
}

async function beginPanePointerDrag(page, handleSelector) {
  const source = page.locator(handleSelector);
  const sourceBox = await source.boundingBox();
  const stackBox = await page.locator('.workbench-stack').boundingBox();
  if (!sourceBox || !stackBox) throw new Error(`pane pointer drag geometry is unavailable: ${handleSelector}`);
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 12, sourceBox.y + sourceBox.height / 2 + 4, { steps: 4 });
  await page.locator('.pane-drop-overlay').waitFor({ state: 'visible' });
  return stackBox;
}

async function movePanePointerToEdge(page, stackBox, edge) {
  const positions = {
    left: [0.34, 0.5],
    right: [0.66, 0.5],
    top: [0.5, 0.34],
    bottom: [0.5, 0.66],
    center: [0.5, 0.5],
  };
  const [xRatio, yRatio] = positions[edge];
  await page.mouse.move(stackBox.x + stackBox.width * xRatio, stackBox.y + stackBox.height * yRatio, { steps: 10 });
}

async function dragPaneWithMouse(page, handleSelector, edge, expectedTerminalPosition, screenshotPath = '') {
  const stackBox = await beginPanePointerDrag(page, handleSelector);
  await movePanePointerToEdge(page, stackBox, edge);
  await page.waitForFunction(position => document.querySelector('.workbench-stack')?.classList.contains(`terminal-${position}`), expectedTerminalPosition);
  if (screenshotPath) await page.screenshot({ path: screenshotPath });
  await page.mouse.up();
  await page.waitForFunction(position => document.querySelector('.workbench-stack')?.classList.contains(`terminal-${position}`), expectedTerminalPosition);
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-pane-drag-'));
  fs.writeFileSync(path.join(fixture, 'pane.md'), '# Pane drag fixture\n\nTerminal movement must preserve this document.\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'qa@docpilot.local'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'DocPilot QA'], { cwd: fixture });
  execFileSync('git', ['add', 'pane.md'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'pane fixture'], { cwd: fixture });

  const app = await electron.launch({ args: ['.', fixture], cwd: root });
  try {
    const page = await waitForEditorWindow(app);
    page.setDefaultTimeout(15000);
    const renderErrors = [];
    page.on('pageerror', error => renderErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') renderErrors.push(message.text()); });
    await page.waitForSelector('.workspace-file-row');
    await dismissReleaseNotice(page);
    await page.evaluate(() => {
      localStorage.removeItem('docpilot:workbench-pane-layout');
      localStorage.setItem('docpilot:terminal-open', 'true');
      localStorage.setItem('docpilot:terminal-orientation', 'vertical');
    });
    await page.reload();
    await page.waitForSelector('.workspace-file-row');
    await dismissReleaseNotice(page);
    await page.locator('.workspace-file-row').filter({ hasText: 'pane.md' }).click();
    await page.waitForSelector('.terminal-pane');

    const stack = page.locator('.workbench-stack');
    if (!await stack.evaluate(node => node.classList.contains('terminal-bottom'))) {
      throw new Error('default terminal pane must start below the document');
    }

    await page.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.locator('.terminal-tabbar').screenshot({ path: path.join(artifacts, 'terminal-tabbar-drag-surface-light.png'), scale: 'css' });
    await page.locator('.theme-toggle button').filter({ hasText: 'Dark' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

    const terminalTabbarDragSurface = page.locator('.terminal-tabbar-drag-surface');
    if (await terminalTabbarDragSurface.getAttribute('draggable') === 'true') {
      throw new Error('terminal tabbar must use pointer drag instead of native HTML drag');
    }
    const dragSurfaceShape = await terminalTabbarDragSurface.evaluate(node => ({
      width: node.getBoundingClientRect().width,
      cursor: getComputedStyle(node).cursor,
    }));
    if (dragSurfaceShape.width < 120 || dragSurfaceShape.cursor !== 'grab') {
      throw new Error(`terminal tabbar drag surface is not usable: ${JSON.stringify(dragSurfaceShape)}`);
    }

    await dragPaneWithMouse(page, '.terminal-tabbar-drag-surface', 'right', 'right');
    await page.getByLabel('Dock terminal below').click();
    await page.waitForFunction(() => document.querySelector('.workbench-stack')?.classList.contains('terminal-bottom'));

    if (await page.locator('.document-tabbar-drag-surface').getAttribute('draggable') === 'true') {
      throw new Error('document tabbar must use pointer drag instead of native HTML drag');
    }

    const previewBounds = await beginPanePointerDrag(page, '.terminal-tabbar-drag-surface');
    await movePanePointerToEdge(page, previewBounds, 'top');
    await page.waitForFunction(() => document.querySelector('.workbench-stack')?.classList.contains('terminal-top'));
    if (await page.locator('.pane-drop-overlay svg').count()) throw new Error('pane drag preview must not render arrow indicators');
    const storedDuringPreview = await page.evaluate(() => JSON.parse(localStorage.getItem('docpilot:workbench-pane-layout') || '{}'));
    if (storedDuringPreview.orientation !== 'vertical' || storedDuringPreview.children?.[1]?.id !== 'terminal') {
      throw new Error(`drag preview must not persist before drop: ${JSON.stringify(storedDuringPreview)}`);
    }
    await movePanePointerToEdge(page, previewBounds, 'center');
    await page.waitForFunction(() => document.querySelector('.workbench-stack')?.classList.contains('terminal-bottom'));
    await page.mouse.up();

    await dragPaneWithMouse(page, '.terminal-tabbar-drag-surface', 'right', 'right', path.join(artifacts, 'pane-drag-dark.png'));
    const storedRight = await page.evaluate(() => JSON.parse(localStorage.getItem('docpilot:workbench-pane-layout') || '{}'));
    if (storedRight.orientation !== 'horizontal' || storedRight.children?.[1]?.id !== 'terminal') {
      throw new Error(`right-side terminal layout was not persisted: ${JSON.stringify(storedRight)}`);
    }

    await page.reload();
    await page.waitForSelector('.workspace-file-row');
    await dismissReleaseNotice(page);
    await page.locator('.workspace-file-row').filter({ hasText: 'pane.md' }).click();
    await page.waitForSelector('.terminal-pane');
    if (!await stack.evaluate(node => node.classList.contains('terminal-right'))) {
      throw new Error('terminal pane position did not restore after reload');
    }

    await page.locator('.terminal-pane-drag-handle').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelector('.workbench-stack')?.classList.contains('terminal-top'));

    if (await page.locator('.document-pane-drag-handle').count()) {
      throw new Error('redundant document pane drag handle must not be rendered');
    }
    await dragPaneWithMouse(page, '.document-tabbar-drag-surface', 'left', 'right');

    await page.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.getByLabel('Collapse project panel').click();
    const chrome = await page.locator('.panel-rail-open-button, .terminal-pane-drag-handle').evaluateAll(nodes => nodes.map(node => ({
      className: node.className,
      borderTopWidth: getComputedStyle(node).borderTopWidth,
      borderStyle: getComputedStyle(node).borderTopStyle,
    })));
    if (chrome.some(item => item.borderTopWidth !== '0px' || item.borderStyle !== 'none')) {
      throw new Error(`pane controls retain outlined chrome: ${JSON.stringify(chrome)}`);
    }
    await page.screenshot({ path: path.join(artifacts, 'pane-borderless-light.png') });
    if (renderErrors.length) throw new Error(`Pane renderer errors: ${JSON.stringify(renderErrors)}`);

    console.log('react pane drag/drop checks passed');
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
