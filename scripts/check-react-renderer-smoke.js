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
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-react-smoke-'));
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Smoke Test\n\nReact renderer file open.\n', 'utf8');

  const app = await electron.launch({
    args: ['.'],
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
      window.docpilot.openFolder(root);
      return true;
    }, fixtureRoot);

    const editor = await waitForReactEditorWindow(app);
    await editor.waitForSelector('.bridge-status');
    await editor.waitForSelector('.workspace-sidebar');
    await editor.waitForSelector('.editor-pane');
    if (await editor.locator('.right-rail button').filter({ hasText: 'Agent' }).count()) {
      await editor.locator('.right-rail button').filter({ hasText: 'Agent' }).click();
    }
    await editor.waitForSelector('.agent-panel');
    await editor.waitForSelector('.agent-controls select');
    await editor.waitForSelector('.agent-status-card');
    await editor.waitForSelector('.agent-compact-steps');
    await editor.waitForSelector('.agent-conversation-toggle');
    const conversationInitiallyVisible = await editor.locator('.agent-conversation').count();
    if (conversationInitiallyVisible) {
      throw new Error('AI conversation should be collapsed by default');
    }
    await editor.locator('.agent-conversation-toggle').click();
    await editor.waitForSelector('.agent-conversation');
    await editor.waitForSelector('.agent-advanced-details');
    await editor.waitForSelector('.context-reference-panel.compact');
    await editor.waitForSelector('.icon-send-button');
    await editor.waitForSelector('.agent-composer');
    await editor.waitForSelector('.agent-header-actions');
    await editor.waitForSelector('.workspace-tabs');
    await editor.waitForSelector('.workspace-file-row');
    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await editor.waitForSelector('.toc-rail');
    await editor.waitForFunction(() => {
      const heading = document.querySelector('.markdown-preview h1');
      return heading && heading.textContent && heading.textContent.trim() === 'Smoke Test';
    });

    const title = await editor.locator('.markdown-preview h1').innerText();
    if (title.trim() !== 'Smoke Test') throw new Error(`unexpected preview title: ${title}`);

    await editor.locator('.workspace-title button').filter({ hasText: '접기' }).waitFor();
    await editor.locator('.agent-header-actions button').filter({ hasText: '접기' }).waitFor();
    const topbarPanelButtons = await editor.locator('.topbar-right .panel-toggle-button').count();
    if (topbarPanelButtons) {
      throw new Error('panel collapse buttons should live inside their panels, not the top bar');
    }
    await editor.locator('.workspace-title button').filter({ hasText: '접기' }).click();
    await editor.waitForSelector('.left-rail .panel-rail-open-button');
    await editor.locator('.left-rail .panel-rail-open-button').click();
    await editor.waitForSelector('.workspace-sidebar');
    await editor.locator('.agent-header-actions button').filter({ hasText: '접기' }).click();
    await editor.waitForSelector('.right-rail .panel-rail-open-button');
    await editor.locator('.right-rail .panel-rail-open-button').click();
    await editor.waitForSelector('.agent-panel');

    await editor.locator('.editor-mode-toggle button').filter({ hasText: '편집' }).click();
    await editor.waitForFunction(() => {
      const numbers = Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
        .map(node => (node.textContent || '').trim())
        .filter(Boolean);
      return numbers.length > 0;
    });
    const lineNumberText = await editor.locator('.cm-lineNumbers .cm-gutterElement').evaluateAll(nodes => (
      nodes.map(node => (node.textContent || '').trim()).filter(Boolean).join(',')
    ));
    if (!lineNumberText) {
      throw new Error('edit mode should show CodeMirror line numbers');
    }
    await editor.locator('.editor-mode-toggle button').filter({ hasText: '프리뷰' }).click();
    await editor.waitForSelector('.markdown-preview h1');

    const contextText = await editor.locator('.context-strip').first().innerText();
    if (!contextText.includes('참고 내용') || !contextText.includes('자동')) {
      throw new Error(`agent context strip did not render: ${contextText}`);
    }
    const bridgeStatus = await editor.locator('.bridge-status').innerText();
    if (!bridgeStatus.includes('문서') && !bridgeStatus.includes('브리지')) {
      throw new Error(`bridge status did not render: ${bridgeStatus}`);
    }

    const tabCount = await editor.locator('.agent-tabs').count();
    if (tabCount) {
      throw new Error('agent panel should not require a separate results tab');
    }
    const headerActions = await editor.locator('.agent-header-actions').innerText();
    if (!headerActions.includes('세션 닫기') || !headerActions.includes('설정')) {
      throw new Error(`agent header actions did not render close/settings actions: ${headerActions}`);
    }
    const statusText = await editor.locator('.agent-status-card').innerText();
    if (!statusText.includes('대기') && !statusText.includes('생각') && !statusText.includes('작업')) {
      throw new Error(`agent status card did not render: ${statusText}`);
    }
    const detailsText = await editor.locator('.agent-advanced-details').innerText();
    if (!detailsText.includes('실행 정보와 고급 로그')) {
      throw new Error(`advanced details did not render: ${detailsText}`);
    }
    await editor.getByText('실행 정보와 고급 로그').click();
    const rawLogText = await editor.locator('.raw-log-panel').innerText();
    if (!rawLogText.includes('고급 로그') || !rawLogText.includes('로그 보기')) {
      throw new Error(`advanced raw log section did not render: ${rawLogText}`);
    }
    await editor.locator('.workspace-tabs button').filter({ hasText: '지침' }).click();
    await editor.waitForSelector('.workspace-instructions-pane .instructions-panel');
    const instructionsVisible = await editor.locator('.workspace-instructions-pane .instructions-panel').count();
    if (!instructionsVisible) {
      throw new Error('instructions panel did not render inside workspace tab');
    }
    await editor.locator('.agent-header-actions button').filter({ hasText: '설정' }).click();
    await editor.waitForSelector('.agent-settings-modal .settings-title');
    const settingsTitle = await editor.locator('.agent-settings-modal .settings-title').innerText();
    if (!settingsTitle.includes('Settings')) {
      throw new Error(`settings panel did not render: ${settingsTitle}`);
    }
    await editor.evaluate(async () => {
      const port = new URLSearchParams(window.location.search).get('port') || '7474';
      await fetch(`http://localhost:${port}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { theme: 'system' } }),
      });
      window.dispatchEvent(new CustomEvent('docpilot-settings-saved', { detail: { settings: { theme: 'system' } } }));
    });
    await editor.waitForFunction(() => document.documentElement.dataset.themePreference === 'system');
    const themePreference = await editor.evaluate(() => document.documentElement.dataset.themePreference);
    if (themePreference !== 'system') {
      throw new Error(`theme preference was not applied: ${themePreference}`);
    }

    console.log('react renderer smoke check passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
