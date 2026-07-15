const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function waitForEditor(app) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const page = app.windows().find(window => window.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('DocPilot editor window did not open.');
}

async function dismissReleaseNotice(page) {
  const notice = page.locator('.release-notice-overlay');
  await notice.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
  if (!await notice.isVisible().catch(() => false)) return;
  const confirm = notice.getByRole('button', { name: '확인' });
  if (await confirm.count()) await confirm.click();
  else await notice.click({ position: { x: 8, y: 8 } });
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-project-search-'));
  fs.mkdirSync(path.join(fixture, 'docs'));
  fs.writeFileSync(path.join(fixture, 'README.md'), '# Search fixture\n', 'utf8');
  fs.writeFileSync(path.join(fixture, 'docs', 'guide.md'), '# Guide\n\nUnique project search evidence.\n', 'utf8');
  const app = await electron.launch({ args: ['.', fixture], cwd: root, env: { ...process.env, DOCPILOT_FAKE_AGENT: '1' } });
  try {
    const page = await waitForEditor(app);
    page.setDefaultTimeout(12_000);
    await page.waitForSelector('.workspace-sidebar');
    await dismissReleaseNotice(page);
    await page.keyboard.press('Meta+Shift+f');
    await page.waitForSelector('.project-search-panel');
    await page.locator('.project-search-input').fill('Unique project search evidence');
    await page.waitForSelector('.project-search-result');
    const result = page.locator('.project-search-result').first();
    const text = await result.innerText();
    if (!text.includes('docs/guide.md') || !text.includes('Line 3') || !text.includes('Unique project search evidence')) {
      throw new Error(`Project search result is incomplete: ${text}`);
    }
    await result.click();
    await page.waitForFunction(() => document.querySelector('.file-tab.active')?.textContent?.includes('guide.md'));
    console.log('react project search checks passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
