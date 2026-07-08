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

async function openWorkspace(repoRoot, root, expectedFile, executablePath = '') {
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ['.'] }),
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_FAKE_AGENT: '1',
    },
  });
  const start = await app.firstWindow();
  await start.waitForLoadState('domcontentloaded');
  await start.evaluate(folder => {
    window.docpilot.openFolder(folder);
    return true;
  }, root);
  const editor = await waitForReactEditorWindow(app);
  await editor.waitForSelector('.workspace-sidebar');
  await editor.waitForSelector('.workspace-recent-list');
  await editor.waitForSelector('.workspace-file-row');
  const primary = await editor.evaluate(async () => {
    const port = new URLSearchParams(window.location.search).get('port') || '7474';
    const response = await fetch(`http://localhost:${port}/file-path?id=${encodeURIComponent('workspace:primary')}`);
    return response.json();
  });
  if (primary.path !== root) {
    throw new Error(`test setup opened the wrong primary workspace: expected ${root}, got ${primary.path}`);
  }
  const fileNames = await editor.locator('.workspace-file-row .tree-name').allInnerTexts();
  if (!fileNames.includes(expectedFile)) {
    throw new Error(`test setup did not open expected file ${expectedFile}, got: ${fileNames.join(', ')}`);
  }
  return { app, editor };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const executablePath = process.env.DOCPILOT_ELECTRON_EXECUTABLE || '';
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-recent-a-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-recent-b-'));
  fs.writeFileSync(path.join(rootA, 'A.md'), '# Root A\n', 'utf8');
  fs.writeFileSync(path.join(rootB, 'B.md'), '# Root B\n', 'utf8');

  let app;
  let editor;
  try {
    const priming = await openWorkspace(repoRoot, rootB, 'B.md', executablePath);
    await priming.app.close().catch(() => {});

    ({ app, editor } = await openWorkspace(repoRoot, rootA, 'A.md', executablePath));
    await editor.evaluate(() => {
      window.__docpilotRecentWindowMarker = 'same-window';
    });

    let closed = false;
    editor.on('close', () => {
      closed = true;
    });

    const clicked = await editor.evaluate(target => {
      const row = Array.from(document.querySelectorAll('.workspace-recent-row'))
        .find(node => node.getAttribute('title') === target);
      if (!(row instanceof HTMLElement)) return false;
      row.click();
      return true;
    }, rootB);
    if (!clicked) {
      const rows = await editor.locator('.workspace-recent-row').evaluateAll(nodes => nodes.map(node => ({
        title: node.getAttribute('title'),
        text: node.textContent,
      })));
      throw new Error(`recent test row was not found for ${rootB}: ${JSON.stringify(rows)}`);
    }
    await editor.waitForTimeout(800);
    if (closed || editor.isClosed()) {
      throw new Error('recent folder sidebar click closed the current editor window');
    }

    const marker = await editor.evaluate(() => window.__docpilotRecentWindowMarker);
    if (marker !== 'same-window') {
      throw new Error(`recent folder click should keep the same renderer window, got marker=${marker}`);
    }

    await editor.waitForSelector('.workspace-file-row');
    const state = await editor.evaluate(async () => {
      const port = new URLSearchParams(window.location.search).get('port') || '7474';
      const [filesResponse, primaryResponse] = await Promise.all([
        fetch(`http://localhost:${port}/files`).then(response => response.json()),
        fetch(`http://localhost:${port}/file-path?id=${encodeURIComponent('workspace:primary')}`).then(response => response.json()),
      ]);
      return { filesResponse, primaryResponse };
    });
    const files = state.filesResponse.files || [];
    if (!files.includes('A.md') || !files.some(file => file.endsWith('/B.md'))) {
      throw new Error(`recent folder should attach beside current workspace files, got: ${files.join(', ')}`);
    }
    const rootNames = await editor.locator('.workspace-root-row span').allInnerTexts();
    if (!rootNames.includes(path.basename(rootB))) {
      throw new Error(`recent folder should appear as an attached root, got: ${rootNames.join(', ')}`);
    }

    const primary = state.primaryResponse;
    if (primary.path !== rootA) {
      throw new Error(`recent folder click should not replace primary workspace, got ${primary.path}`);
    }

    await editor.evaluate(([a, b]) => Promise.all([
      window.docpilot.removeRecent?.(a),
      window.docpilot.removeRecent?.(b),
    ]), [rootA, rootB]);

    console.log(`${executablePath ? 'packaged ' : ''}react recent folder stability check passed`);
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
