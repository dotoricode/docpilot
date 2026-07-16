const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const {
  createFixture,
  dismissReleaseNotice,
  openFile,
  waitForEditor,
} = require('./capture-manual-v2-demos');

const repoRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(repoRoot, 'prototypes/manual-v2/public/media/images');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function target(locator, label) {
  await locator.first().waitFor({ state: 'attached' });
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!await item.isVisible()) continue;
    const box = await item.boundingBox();
    if (box) return { label, box };
  }
  throw new Error(`Cannot annotate visible target ${label}.`);
}

async function capture(page, name, title, targets) {
  const boxes = [];
  for (const [locator, label] of targets) boxes.push(await target(locator, label));
  await page.evaluate(({ title: heading, boxes: annotations }) => {
    document.querySelector('[data-manual-static-annotations]')?.remove();
    const root = document.createElement('div');
    root.dataset.manualStaticAnnotations = 'true';
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
    });
    const titleBar = document.createElement('div');
    titleBar.textContent = heading;
    Object.assign(titleBar.style, {
      position: 'absolute', left: '24px', top: '54px', padding: '10px 14px',
      border: '1px solid rgba(255, 145, 64, .9)', borderRadius: '9px',
      background: 'rgba(13, 16, 18, .92)', color: '#fff5ec', fontSize: '18px',
      fontWeight: '700', boxShadow: '0 10px 28px rgba(0,0,0,.38)',
    });
    root.appendChild(titleBar);
    annotations.forEach(({ label, box }, index) => {
      const outline = document.createElement('div');
      Object.assign(outline.style, {
        position: 'absolute', left: `${Math.max(4, box.x - 5)}px`, top: `${Math.max(4, box.y - 5)}px`,
        width: `${box.width + 10}px`, height: `${box.height + 10}px`,
        border: '2px solid #ff8a3d', borderRadius: '7px',
        boxShadow: '0 0 0 3px rgba(255, 138, 61, .2)',
      });
      const chip = document.createElement('div');
      chip.textContent = `${index + 1}  ${label}`;
      const top = box.y > 115 ? box.y - 34 : box.y + box.height + 10;
      Object.assign(chip.style, {
        position: 'absolute', left: `${Math.max(8, Math.min(box.x, innerWidth - 330))}px`, top: `${top}px`,
        maxWidth: '310px', padding: '6px 9px', borderRadius: '6px',
        background: '#ff8a3d', color: '#17110d', fontSize: '13px', fontWeight: '750',
        boxShadow: '0 5px 16px rgba(0,0,0,.42)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      });
      root.append(outline, chip);
    });
    document.body.appendChild(root);
  }, { title, boxes });
  await page.screenshot({ path: path.join(outputRoot, `${name}.jpg`), type: 'jpeg', quality: 90 });
  await page.evaluate(() => document.querySelector('[data-manual-static-annotations]')?.remove());
  process.stdout.write(`${name}\n`);
}

async function goHome(page) {
  await page.getByRole('button', { name: '홈으로 이동' }).click();
  await page.waitForSelector('.home-screen');
  await wait(350);
}

async function selectMode(page, name) {
  await page.locator('.editor-mode-toggle').getByRole('button', { name, exact: true }).click();
  await wait(350);
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const fixture = createFixture('static-media');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-static-media-user-'));
  const app = await electron.launch({
    args: ['.', fixture],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_USER_DATA_DIR: userData, ZDOTDIR: userData },
  });

  try {
    const page = await waitForEditor(app);
    page.setDefaultTimeout(20_000);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1440, 900);
      window.center();
      window.show();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await dismissReleaseNotice(page);
    await page.evaluate(() => {
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.0:r2');
      localStorage.setItem('docpilot:terminal-open', '0');
      localStorage.setItem('docpilot:preview-width', '760');
    });
    await page.reload();
    await page.waitForSelector('.home-screen');
    await dismissReleaseNotice(page);

    const quickOpen = page.getByRole('button', { name: 'Quick open', exact: true });
    const openRecent = page.getByRole('button', { name: 'Open recent document' });
    const recentList = page.locator('.home-file-list');
    await capture(page, 'install-download-launch', '설치 후 실제 DocPilot 시작 화면', [
      [page.locator('.app-logo'), '실행된 DocPilot'],
      [page.locator('.home-project-heading'), '연결된 프로젝트'],
      [quickOpen, '첫 문서 열기'],
    ]);
    await capture(page, 'first-workspace-open', '첫 작업공간에서 문서를 여는 위치', [
      [page.locator('.home-project-header'), '현재 작업공간'],
      [quickOpen, '빠른 열기 버튼'],
      [recentList, '열 수 있는 문서'],
    ]);
    await capture(page, 'recent-locations', '최근 문서와 작업공간 복원', [
      [openRecent, '가장 최근 문서 열기'],
      [recentList, '최근 문서 목록'],
      [page.locator('.topbar-chip'), '현재 Workspace'],
    ]);

    await openFile(page, 'README.md');
    await page.locator('.workspace-tree').click({ button: 'right', position: { x: 160, y: 360 } });
    await page.waitForSelector('.tree-context-menu');
    await capture(page, 'additional-folders', 'Project 패널에서 보조 Workspace 추가', [
      [page.locator('.workspace-tree-search'), 'Project 패널'],
      [page.locator('.tree-context-menu').getByRole('button', { name: '워크스페이스 추가' }), '워크스페이스 추가'],
      [page.locator('.workspace-tree'), '추가 루트가 나타나는 트리'],
    ]);
    await page.keyboard.press('Escape');

    const readmeRow = page.locator('.workspace-file-row').filter({ hasText: 'README.md' });
    await readmeRow.click({ button: 'right' });
    await page.waitForSelector('.tree-context-menu');
    await capture(page, 'file-explorer', '파일 탐색기에서 찾고 열고 관리하기', [
      [page.locator('.workspace-tree-search'), '파일 이름 필터'],
      [readmeRow, '파일 트리 항목'],
      [page.locator('.tree-context-menu'), '파일 작업 메뉴'],
    ]);
    await page.keyboard.press('Escape');

    await selectMode(page, 'Source');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Meta+End');
    await page.keyboard.type('\nVerification note pending.', { delay: 45 });
    await page.waitForSelector('.dirty-pill');
    await capture(page, 'source-edit-save', 'Source에서 편집하고 저장하기', [
      [page.locator('.editor-mode-toggle').getByRole('button', { name: 'Source' }), 'Source 모드'],
      [page.locator('.dirty-pill'), '수정 상태'],
      [page.getByRole('button', { name: '저장', exact: true }), '저장 버튼'],
    ]);
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await selectMode(page, 'Preview');
    await capture(page, 'markdown-preview-example', 'Markdown 실제 Preview 예시', [
      [page.locator('.editor-mode-toggle'), 'Source · Rich · Preview'],
      [page.locator('.markdown-preview h1'), '렌더링된 제목과 본문'],
      [page.locator('.toc-rail'), '문서 목차'],
    ]);

    await openFile(page, 'manual.adoc');
    await page.waitForFunction(() => document.querySelectorAll('.toc-rail button').length > 20);
    await capture(page, 'asciidoc-preview-example', '긴 AsciiDoc 실제 Preview 예시', [
      [page.locator('.editor-mode-toggle').getByRole('button', { name: 'Preview' }), 'AsciiDoc Preview'],
      [page.locator('.markdown-preview'), '렌더링된 장문 매뉴얼'],
      [page.locator('.toc-rail'), '90개 장의 목차'],
    ]);

    await openFile(page, 'sample.json');
    await page.waitForSelector('.json-tree');
    await capture(page, 'json-tree-example', 'JSON 실제 Tree 예시', [
      [page.locator('.editor-mode-toggle'), 'Source · Tree'],
      [page.getByRole('button', { name: 'Format JSON' }), 'JSON 포맷'],
      [page.locator('.json-tree'), '펼쳐 보는 구조'],
    ]);

    await openFile(page, 'manual.md');
    await page.locator('.editor-more-menu summary').click();
    await capture(page, 'preview-controls', 'Preview 탐색과 표시 설정 위치', [
      [page.locator('.editor-mode-toggle').getByRole('button', { name: 'Preview' }), 'Preview 버튼'],
      [page.locator('.editor-more-popover'), '줄 번호와 읽기 폭'],
      [page.locator('.toc-rail'), '목차 탐색'],
    ]);
    await page.keyboard.press('Escape');

    await page.locator('.theme-toggle button').nth(0).click();
    await wait(500);
    await capture(page, 'appearance-theme', '화면 상단에서 테마 전환', [
      [page.locator('.theme-toggle'), 'Light · Dark 선택'],
      [page.locator('.workspace-sidebar'), 'Project 패널 적용'],
      [page.locator('.editor-pane'), '문서 전체 적용 결과'],
    ]);
    await page.locator('.theme-toggle button').nth(1).click();
    await openFile(page, 'README.md');
    await page.locator('.editor-more-menu summary').click();
    await capture(page, 'settings-reference', '문서별 표시 설정과 앱 설정 위치', [
      [page.locator('.theme-toggle'), '앱 테마 설정'],
      [page.locator('.editor-more-popover'), '문서 표시 설정'],
      [page.locator('.editor-mode-toggle'), '문서 모드 설정'],
    ]);
    await page.keyboard.press('Escape');

    await goHome(page);
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.quick-open-panel');
    await page.locator('.quick-open-panel input').fill('manual');
    await capture(page, 'shortcut-reference', '대표 단축키 ⌘P로 빠른 열기', [
      [page.locator('.quick-open-panel input'), '⌘P로 열린 입력'],
      [page.locator('.quick-open-results'), '키보드로 선택할 결과'],
      [page.locator('.quick-open-row.active'), 'Enter로 열 항목'],
    ]);
    await page.keyboard.press('Escape');

    await page.keyboard.press('Meta+Shift+f');
    await page.waitForSelector('.project-search-panel');
    const searchInput = page.locator('.project-search-panel input[type="search"]');
    await searchInput.fill('missing-public-demo-token');
    await wait(500);
    await capture(page, 'troubleshooting-states', '검색 결과가 없을 때 확인할 위치', [
      [searchInput, '입력과 옵션 확인'],
      [page.locator('.project-search-results'), '결과 또는 빈 상태'],
      [page.locator('.project-search-panel').getByRole('button', { name: '닫기' }), '패널 닫고 다시 시도'],
    ]);

    await page.locator('.project-search-panel').getByRole('button', { name: '닫기' }).click();
    await page.evaluate(() => localStorage.removeItem('docpilot:release-notice-seen-id'));
    await page.reload();
    await page.waitForSelector('.release-notice-overlay');
    await capture(page, 'update-release-flow', '새 버전 안내에서 변경사항 확인', [
      [page.locator('.release-notice-overlay'), '새 버전과 주요 변경'],
      [page.locator('.release-notice-overlay').getByRole('button', { name: '확인' }), '확인 후 계속'],
      [page.locator('.app-logo'), '업데이트된 DocPilot'],
    ]);
  } finally {
    await app.close().catch(() => {});
    try { execFileSync('pkill', ['-f', `bridge.js --root ${fixture}`]); } catch {}
    fs.rmSync(path.dirname(fixture), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
