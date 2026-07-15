const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function launchWithTheme(repoRoot, theme) {
  const artifactRoot = path.join(repoRoot, 'tests', 'artifacts', 'launch-experience');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `docpilot-launch-${theme}-`));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ themePreference: theme }, null, 2));
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_USER_DATA_DIR: userData },
  });
  try {
    const page = await app.firstWindow();
    const rendererErrors = [];
    page.on('pageerror', error => rendererErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') rendererErrors.push(message.text());
    });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.launch-shell', { timeout: 4000 });
    const surface = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      preference: document.documentElement.dataset.themePreference,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      primaryAction: document.querySelector('#open-btn')?.textContent?.trim(),
      hasEmoji: /[\u{1F300}-\u{1FAFF}]/u.test(document.body.textContent || ''),
    }));
    if (surface.theme !== theme || surface.preference !== theme) {
      throw new Error(`start window must apply stored ${theme} theme before interaction: ${JSON.stringify(surface)}`);
    }
    if (!surface.primaryAction?.includes('프로젝트 폴더 열기') || surface.hasEmoji) {
      throw new Error(`project-open surface must keep the polished non-emoji primary action: ${JSON.stringify(surface)}`);
    }
    await page.screenshot({ path: path.join(artifactRoot, `project-open-${theme}.png`) });
    const identity = await app.evaluate(({ app: electronApp, Menu }) => ({
      appName: electronApp.name,
      processTitle: process.title,
      firstMenuLabel: Menu.getApplicationMenu()?.items[0]?.label || '',
      productName: electronApp.getName(),
    }));
    if (identity.appName !== 'DocPilot' || identity.firstMenuLabel !== 'DocPilot' || !identity.processTitle.includes('DocPilot')) {
      throw new Error(`macOS identity must be DocPilot: ${JSON.stringify(identity)}`);
    }
    if (rendererErrors.length) throw new Error(`launch window renderer errors: ${rendererErrors.join(' | ')}`);
    return surface;
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  await launchWithTheme(repoRoot, 'light');
  await launchWithTheme(repoRoot, 'dark');
  console.log('react launch experience checks passed');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
