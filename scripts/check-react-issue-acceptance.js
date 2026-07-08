const assert = require('assert');
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

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const agentPanelSource = fs.readFileSync(path.join(repoRoot, 'app/src/features/agent-panel/AgentPanel.tsx'), 'utf8');
  assert(
    agentPanelSource.includes('event.nativeEvent.isComposing') && agentPanelSource.includes('event.preventDefault();'),
    'AgentPanel should guard IME composing Enter before submit',
  );
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-issue-acceptance-'));
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Acceptance\n\n한글 문장\n', 'utf8');

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
      window.localStorage.clear();
      window.docpilot.openFolder(root);
      return true;
    }, workspace);

    const page = await waitForReactEditorWindow(app);
    await page.waitForSelector('.bridge-status', { timeout: 15000 });
    await page.waitForSelector('.workspace-file-row', { timeout: 15000 });
    const initialBodyText = await page.locator('body').innerText();
    assert(!initialBodyText.includes('Agent별 세션 분리'), 'agent session policy note should not render');
    assert(!initialBodyText.includes('선택한 세션만 닫힘'), 'agent selected-session close note should not render');

    await page.locator('.workspace-title button').filter({ hasText: '접기' }).click();
    await page.waitForSelector('.left-rail .panel-rail-open-button');
    await page.locator('.left-rail .panel-rail-open-button').click();
    await page.waitForSelector('.workspace-sidebar');
    await page.locator('.agent-header-actions button').filter({ hasText: '접기' }).click();
    await page.waitForSelector('.right-rail .panel-rail-open-button');
    await page.locator('.right-rail .panel-rail-open-button').click();
    await page.waitForSelector('.agent-panel');
    await page.locator('.workspace-title button').filter({ hasText: '접기' }).click();
    await page.waitForSelector('.left-rail .panel-rail-open-button');
    const storedLayout = await page.evaluate(() => ({
      leftCollapsed: window.localStorage.getItem('docpilot:left-panel-collapsed'),
      leftWidth: window.localStorage.getItem('docpilot:left-panel-width'),
    }));
    assert.strictEqual(storedLayout.leftCollapsed, '1', 'left panel collapsed state should persist');
    assert(Number(storedLayout.leftWidth) >= 220, 'left panel width should persist');
    await page.locator('.left-rail .panel-rail-open-button').click();
    await page.waitForSelector('.workspace-sidebar');
    await page.waitForSelector('.workspace-file-row', { timeout: 15000 });

    await page.locator('.workspace-tree').click({ button: 'right' });
    await page.waitForSelector('.tree-context-menu');
    const menuText = await page.locator('.tree-context-menu').innerText();
    assert(menuText.includes('워크스페이스 추가'), 'blank tree context menu should add workspace');
    assert(menuText.includes('Finder에서 열기'), 'blank tree context menu should open workspace folder');
    await page.mouse.click(20, 20);
    await page.waitForFunction(() => !document.querySelector('.tree-context-menu'));

    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click({ button: 'right' });
    await page.waitForSelector('.tree-context-menu');
    const fileMenuText = await page.locator('.tree-context-menu').innerText();
    assert(fileMenuText.includes('Finder에서 위치 열기'), 'file context menu should open parent folder');
    await page.keyboard.press('Escape');

    const bodyText = await page.locator('body').innerText();
    assert(bodyText.includes('참고 범위'), 'composer should use clear reference scope label');
    assert(bodyText.includes('자동'), 'composer should use a short automatic reference scope label');
    assert(!bodyText.includes('앱이 알아서 선택'), 'old verbose automatic reference scope label should not render');
    assert(bodyText.includes('보내는 방식'), 'composer should use clear send mode label');
    assert(!bodyText.includes('참고 자료'), 'old context label should not render');
    assert(!bodyText.includes('전송 방식'), 'old send mode label should not render');
    assert(!bodyText.includes('원문 로그'), 'raw log should not be visible in the default lower UI');
    assert(!bodyText.includes('요청을 입력하면 여기에 진행 상황과 응답이 표시됩니다.'), 'empty chat should not show instructional filler text');

    await page.locator('.agent-controls select').nth(1).selectOption('clarify');
    const composer = page.locator('.agent-composer > textarea');
    await composer.fill('좋게 정리해줘');
    await page.getByRole('button', { name: '확인 질문 만들기' }).click();
    await page.waitForSelector('.prompt-package-preview');
    const previewText = await page.locator('.prompt-package-preview').innerText();
    assert(previewText.includes('원본 입력'), 'clarify mode should show original input');
    assert(previewText.includes('확인 질문'), 'clarify mode should show a question');
    assert(previewText.includes('최종 전달 프롬프트'), 'clarify mode should show final prompt');

    await page.locator('.agent-controls select').nth(1).selectOption('instant');
    await composer.fill('한글 입력 테스트');
    await page.getByRole('button', { name: '보내기' }).click();
    await page.waitForFunction(() => {
      const textarea = document.querySelector('.agent-composer > textarea');
      return textarea && textarea.value === '';
    }, null, { timeout: 8000 });
    await page.locator('.agent-conversation-toggle').click();
    await page.waitForSelector('.agent-message.assistant', { timeout: 15000 });

    await page.getByText('실행 정보와 고급 로그').click();
    await page.getByRole('button', { name: '로그 보기' }).click();
    await page.getByRole('button', { name: '터미널 열기' }).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector('.raw-log-panel.open');
      return panel && panel.textContent && panel.textContent.includes('터미널 닫기');
    }, null, { timeout: 15000 });
    const terminalSessions = await page.evaluate(async () => {
      const port = new URLSearchParams(window.location.search).get('port') || '7474';
      const response = await fetch(`http://localhost:${port}/terminal-sessions`);
      return response.json();
    });
    assert(terminalSessions.sessions.some(session => session.agent === 'claude' && session.status === 'running'), 'raw log terminal should create a running claude terminal session');
    const rawLogText = await page.locator('.raw-log-panel.open').innerText();
    assert(!rawLogText.includes('Failed to fetch'), 'raw log terminal should not show Failed to fetch');
    assert(rawLogText.includes('터미널 닫기'), 'raw log terminal should switch to close action after opening');

    console.log(`${executablePath ? 'packaged ' : ''}react issue acceptance checks passed`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
