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
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-agent-stream-'));
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Agent Stream\n\nStreaming check.\n', 'utf8');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_FAKE_AGENT_DELAY_MS: '120',
      DOCPILOT_FAKE_AGENT_CHUNK_SIZE: '8',
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
    await editor.waitForSelector('.bridge-status.connected', { timeout: 12000 });
    if (await editor.locator('.right-rail button').filter({ hasText: 'Agent' }).count()) {
      await editor.locator('.right-rail button').filter({ hasText: 'Agent' }).click();
    }
    await editor.waitForSelector('.agent-panel');
    await editor.waitForSelector('.agent-conversation-toggle');
    await editor.locator('.agent-conversation-toggle').click();
    await editor.waitForSelector('.agent-conversation');
    await editor.locator('.agent-composer textarea').fill('현재 문서 구성을 짧게 점검해줘.');
    await editor.locator('.agent-composer button').filter({ hasText: '보내기' }).click();

    await editor.waitForSelector('.agent-message.user');
    await editor.waitForFunction(() => {
      const text = document.querySelector('.agent-conversation')?.textContent || '';
      return text.includes('fake claude');
    }, null, { timeout: 8000 });

    const liveText = await editor.locator('.agent-conversation').innerText();
    if (!liveText.includes('fake claude')) {
      throw new Error(`streaming assistant text was not visible: ${liveText}`);
    }
    const tabCount = await editor.locator('.agent-tabs').count();
    if (tabCount) {
      throw new Error('streaming turn should stay in the conversation without a separate results tab');
    }

    await editor.waitForFunction(() => {
      const status = document.querySelector('.agent-status-card')?.textContent || '';
      const text = document.querySelector('.agent-conversation')?.textContent || '';
      return status.includes('완료') && text.includes('fake claude response');
    }, null, { timeout: 10000 });

    const finalText = await editor.locator('.agent-conversation').innerText();
    if (!finalText.includes('fake claude response')) {
      throw new Error(`assistant response disappeared after completion: ${finalText}`);
    }
    console.log('react agent streaming check passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
