import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [baseUrl = 'http://127.0.0.1:4173', outputDir = '.tink/current/artifacts/prototype'] = process.argv.slice(2);

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1024 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
const errors = [];
let widthChanged = false;
let widthStorageWrites = 0;

page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', error => errors.push(`page: ${error.message}`));

try {
  await page.goto(`${baseUrl}/#changelog`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('docpilot-manual-theme', 'dark');
    localStorage.setItem('docpilot-manual-width', '760');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('h1').filter({ hasText: '문서 작업을 위한 새로운 워크벤치' }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'release-highlights-dark-1440x1024.png'), fullPage: false, animations: 'disabled' });
  await page.getByRole('button', { name: '변경 사항 전체 보기', exact: true }).click();
  await page.locator('h1').filter({ hasText: '변경 사항 전체 보기' }).waitFor();
  if (!page.url().endsWith('#/changelog/all-releases')) throw new Error(`Full changelog must use a distinct URL: ${page.url()}`);
  await page.getByRole('heading', { name: '추가됨', exact: true }).waitFor();
  await page.getByRole('heading', { name: '알려진 제한', exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('h1').filter({ hasText: '변경 사항 전체 보기' }).waitFor();
  const changelogCapture = await browser.newPage({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 1 });
  await changelogCapture.goto(`${baseUrl.replace(/\/$/, '')}/?theme=dark#/changelog/all-releases`, { waitUntil: 'networkidle' });
  await changelogCapture.locator('h1').filter({ hasText: '변경 사항 전체 보기' }).waitFor();
  await changelogCapture.screenshot({ path: path.join(outputDir, 'full-changelog-dark-1440x1024.png'), fullPage: false });
  await changelogCapture.close();

  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.locator('h1').filter({ hasText: 'DocPilot에서 문서 작업을 시작하세요' }).waitFor();
  await page.getByRole('button', { name: '탭과 분할 보기', exact: true }).click();
  await page.locator('h1').filter({ hasText: '문서와 터미널을 원하는 방향에 배치하세요' }).waitFor();
  if (!page.url().endsWith('#/docs/split')) throw new Error(`Docs navigation must update the URL: ${page.url()}`);
  await page.locator('.docs-outline').getByText('분할 보기 만들기', { exact: true }).waitFor();
  const guideVideoSource = await page.locator('.document-article video source').first().getAttribute('src');
  if (!guideVideoSource?.includes('guide-split')) throw new Error(`Split guide must use its dedicated demo: ${guideVideoSource}`);
  await page.getByRole('button', { name: 'Diff와 변경 비교', exact: true }).click();
  await page.locator('h1').filter({ hasText: '원문과 렌더링 결과에서 변경사항을 검토하세요' }).waitFor();
  if (!page.url().endsWith('#/docs/diff')) throw new Error(`Second Docs navigation must update the URL: ${page.url()}`);
  await page.getByRole('button', { name: '탭과 분할 보기', exact: true }).click();
  await page.locator('h1').filter({ hasText: '문서와 터미널을 원하는 방향에 배치하세요' }).waitFor();
  await page.evaluate(() => {
    window.__manualWidthStorageWrites = 0;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (key === 'docpilot-manual-width') window.__manualWidthStorageWrites += 1;
      return originalSetItem.call(this, key, value);
    };
  });
  const beforeWidth = await page.locator('.document-article').evaluate(element => element.getBoundingClientRect().width);
  const separator = page.getByRole('separator', { name: '본문 너비 조절' });
  const box = await separator.boundingBox();
  if (!box) throw new Error('Reading width separator is not visible.');
  await page.mouse.move(box.x + box.width / 2, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + 180, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(
    previousWidth => document.querySelector('.document-article')?.getBoundingClientRect().width > previousWidth + 20,
    beforeWidth,
  );
  const afterWidth = await page.locator('.document-article').evaluate(element => element.getBoundingClientRect().width);
  widthChanged = afterWidth > beforeWidth + 20;
  widthStorageWrites = await page.evaluate(() => window.__manualWidthStorageWrites);
  if (widthStorageWrites > 2) throw new Error(`Manual width drag wrote storage ${widthStorageWrites} times`);
  await page.screenshot({ path: path.join(outputDir, 'docs-dark-wide-1440x1024.png'), fullPage: false, animations: 'disabled' });

  await page.keyboard.press('Meta+K');
  await page.getByPlaceholder('문서, 기능 또는 릴리스 검색').fill('Diff');
  await page.getByText('Diff와 변경사항 검토', { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(outputDir, 'search-dark-1440x1024.png'), fullPage: false, animations: 'disabled' });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '라이트 테마' }).click();
  const lightTheme = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue('--workbench-bg').trim(),
      editor: style.getPropertyValue('--workbench-editor').trim(),
      text: style.getPropertyValue('--workbench-text').trim(),
    };
  });
  if (JSON.stringify(lightTheme) !== JSON.stringify({ background: '#f7f7f8', editor: '#ffffff', text: '#202329' })) {
    throw new Error(`Manual light theme must match DocPilot workbench tokens: ${JSON.stringify(lightTheme)}`);
  }
  await page.screenshot({ path: path.join(outputDir, 'docs-light-1440x1024.png'), fullPage: false, animations: 'disabled' });

  await page.getByRole('button', { name: 'Changelog', exact: true }).click();
  await page.getByRole('button', { name: '데모 보기', exact: true }).first().click();
  await page.getByRole('dialog', { name: '문서 중심 워크벤치 데모' }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'demo-dialog-light-1440x1024.png'), fullPage: false, animations: 'disabled' });
  await page.getByRole('button', { name: '데모 닫기' }).click();

  await page.getByRole('button', { name: '다크 테마' }).click();
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('button', { name: '탭과 분할 보기', exact: true }).click();
  await page.setViewportSize({ width: 980, height: 760 });
  await page.screenshot({ path: path.join(outputDir, 'docs-dark-constrained-980x760.png'), fullPage: false, animations: 'disabled' });

  console.log(JSON.stringify({
    result: errors.length ? 'failed' : 'passed',
    beforeWidth,
    afterWidth,
    widthChanged,
    widthStorageWrites,
    errors,
  }));
} finally {
  await browser.close();
}

if (errors.length || !widthChanged) process.exitCode = 1;
