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

async function main() {
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-home-workbench-'));
  fs.mkdirSync(path.join(fixture, 'docs'));
  fs.writeFileSync(path.join(fixture, 'README.md'), '# Home fixture\n', 'utf8');
  fs.writeFileSync(path.join(fixture, 'docs', 'guide.md'), '# Guide\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'qa@docpilot.local'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'DocPilot QA'], { cwd: fixture });
  execFileSync('git', ['add', '.'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'home fixture'], { cwd: fixture });

  const app = await electron.launch({ args: ['.', fixture], cwd: root });
  try {
    const page = await waitForEditorWindow(app);
    const renderErrors = [];
    page.on('pageerror', error => renderErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') renderErrors.push(message.text()); });
    await page.waitForSelector('.home-screen');
    await dismissReleaseNotice(page);

    const structure = await page.evaluate(() => ({
      projectHeader: Boolean(document.querySelector('.home-project-header')),
      recentSection: Boolean(document.querySelector('.home-recent-section')),
      statusDot: Boolean(document.querySelector('.home-project-status-dot')),
      actionIcons: document.querySelectorAll('.home-actions button svg').length,
      backgroundImage: getComputedStyle(document.querySelector('.home-screen')).backgroundImage,
      outlinedActions: [...document.querySelectorAll('.home-actions button')].filter(button => getComputedStyle(button).borderTopWidth !== '0px').length,
      homeTop: Math.round(document.querySelector('.home-screen').getBoundingClientRect().top),
      projectHeaderTop: Math.round(document.querySelector('.home-project-header').getBoundingClientRect().top),
    }));
    if (!structure.projectHeader || !structure.recentSection || !structure.statusDot) {
      throw new Error(`Home is missing Orca project hierarchy: ${JSON.stringify(structure)}`);
    }
    if (structure.actionIcons < 2) throw new Error(`Home actions must use icon-library icons: ${JSON.stringify(structure)}`);
    if (structure.backgroundImage !== 'none') throw new Error(`Home retains decorative gradients: ${structure.backgroundImage}`);
    if (structure.outlinedActions) throw new Error(`Home retains ${structure.outlinedActions} outlined action buttons`);
    if (structure.projectHeaderTop - structure.homeTop > 120) {
      throw new Error(`Home project hierarchy starts too low: ${JSON.stringify(structure)}`);
    }
    if (structure.homeTop > 120) throw new Error(`Home surface does not fill the workbench: ${JSON.stringify(structure)}`);

    await page.getByRole('button', { name: 'Quick open', exact: true }).click();
    await page.waitForSelector('.quick-open-overlay');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Open recent document/ }).click();
    await page.waitForSelector('.editor-mode-toggle');
    await page.getByLabel('홈으로 이동').click();
    await page.waitForSelector('.home-screen');

    const artifacts = path.join(root, '.tink', 'current', 'artifacts');
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'home-orca-dark.png') });
    await page.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.screenshot({ path: path.join(artifacts, 'home-orca-light.png') });
    if (renderErrors.length) throw new Error(`Home renderer errors: ${JSON.stringify(renderErrors)}`);

    console.log('react home workbench checks passed');
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
