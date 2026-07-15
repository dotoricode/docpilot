const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-start-scroll-'));
  const recentFolders = Array.from({ length: 10 }, (_, index) => `/Users/demo/projects/document-workspace-${index + 1}`);
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ themePreference: 'light', recentFolders }, null, 2));

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_USER_DATA_DIR: userData },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.recent-item');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(760, 520);
    });
    await page.waitForTimeout(150);

    const geometry = await page.evaluate(() => {
      const shell = document.querySelector('.launch-shell').getBoundingClientRect();
      const recents = document.querySelector('.launch-recents').getBoundingClientRect();
      const list = document.querySelector('.recent-list');
      const footer = document.querySelector('.launch-action').getBoundingClientRect();
      const button = document.querySelector('#open-btn').getBoundingClientRect();
      const before = list.scrollTop;
      list.scrollTop = 120;
      const after = list.scrollTop;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        shell: { top: shell.top, bottom: shell.bottom, height: shell.height },
        recents: { top: recents.top, bottom: recents.bottom, height: recents.height },
        footer: { top: footer.top, bottom: footer.bottom, height: footer.height },
        button: { top: button.top, bottom: button.bottom, height: button.height },
        list: { clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, before, after },
      };
    });
    const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
    fs.mkdirSync(artifactRoot, { recursive: true });
    await page.screenshot({ path: path.join(artifactRoot, 'start-window-scroll-light.png') });

    const failures = [];
    if (!(geometry.list.scrollHeight > geometry.list.clientHeight)) failures.push('recent list is not overflow-constrained');
    if (!(geometry.list.after > geometry.list.before)) failures.push('recent list cannot scroll');
    if (!(geometry.button.height > 0 && geometry.button.bottom <= geometry.viewport.height)) failures.push('open button is outside the viewport');
    if (!(geometry.footer.bottom <= geometry.shell.bottom + 1)) failures.push('open footer is pushed outside the launch shell');
    if (!(geometry.recents.bottom <= geometry.footer.top + 1)) failures.push('recent projects overlap the open footer');

    if (failures.length) {
      throw new Error(`${failures.join('; ')}: ${JSON.stringify(geometry)}`);
    }
    console.log(`start window scroll contract passed: ${JSON.stringify(geometry)}`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
