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
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-toc-navigation-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-toc-navigation-user-'));
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), [
    '# Component Guide',
    '',
    'Intro text.',
    '',
    '```md',
    '# CODE-BLOCK-HEADING',
    '## 코드블록 내부 제목',
    '```',
    '',
    '## 1. 문서 계층',
    '',
    '첫 번째 섹션.',
    '',
    '### FR / NFR',
    '',
    'FR section.',
    '',
    '#### FR-{COMP}-{NNN}: <제목>',
    '',
    'Deep section.',
    '',
    '##### 배경',
    '',
    'Very deep section.',
    '',
    '##### 계약 / 인터페이스',
    '',
    '계약 섹션.',
    '',
    ...Array.from({ length: 50 }, (_, index) => `Filler paragraph ${index + 1}.`),
    '',
    '## 2. 다음 섹션',
    '',
    'Next section.',
  ].join('\n'), 'utf8');

  const executablePath = process.env.DOCPILOT_ELECTRON_EXECUTABLE || '';
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ['.'] }),
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_USER_DATA_DIR: userData,
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
    await editor.waitForSelector('.workspace-file-row', { timeout: 15000 });
    const releaseNotice = editor.getByRole('dialog', { name: '새 버전 안내' });
    if (await releaseNotice.isVisible().catch(() => false)) {
      await releaseNotice.getByRole('button', { name: '확인' }).click();
    }
    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    const documentMode = editor.locator('.editor-mode-toggle button').filter({ hasText: /^Document$/ });
    if (!await documentMode.evaluate(node => node.classList.contains('active'))) await documentMode.click();
    await editor.waitForSelector('.document-markdown-content[contenteditable="true"]');
    await editor.waitForSelector('.toc-rail .toc-item');

    const layout = await editor.locator('.editor-workspace.document').evaluate(shell => {
      const documentEditor = shell.querySelector('.document-editor-shell');
      const tocRail = shell.querySelector(':scope > .toc-rail');
      const shellRect = shell.getBoundingClientRect();
      const documentRect = documentEditor ? documentEditor.getBoundingClientRect() : null;
      const tocRect = tocRail ? tocRail.getBoundingClientRect() : null;
      return {
        columns: getComputedStyle(shell).gridTemplateColumns,
        documentRight: documentRect ? documentRect.right - shellRect.left : -1,
        tocLeft: tocRect ? tocRect.left - shellRect.left : -1,
      };
    });
    if (!layout.columns.includes('220px') || layout.tocLeft < layout.documentRight) {
      throw new Error(`Document TOC should sit to the right of the editable document: ${JSON.stringify(layout)}`);
    }

    const toc = await editor.locator('.toc-rail .toc-item').evaluateAll(items => items.map(item => ({
      text: item.textContent || '',
      className: item.className,
      paddingLeft: getComputedStyle(item).paddingLeft,
    })));
    const deep = toc.find(item => item.text.includes('FR-{COMP}-{NNN}'));
    const veryDeep = toc.find(item => item.text.includes('배경'));
    if (toc.some(item => item.text.includes('CODE-BLOCK-HEADING') || item.text.includes('코드블록 내부 제목'))) {
      throw new Error(`TOC must not include headings from fenced code blocks: ${JSON.stringify(toc)}`);
    }
    if (!deep || !deep.className.includes('toc-h4')) {
      throw new Error(`TOC should include h4 with depth class: ${JSON.stringify(toc)}`);
    }
    if (!veryDeep || !veryDeep.className.includes('toc-h5')) {
      throw new Error(`TOC should include h5 with depth class: ${JSON.stringify(toc)}`);
    }
    if (Number.parseFloat(veryDeep.paddingLeft) <= Number.parseFloat(deep.paddingLeft)) {
      throw new Error(`TOC deeper heading should have larger indent: ${JSON.stringify({ deep, veryDeep })}`);
    }

    await editor.locator('.toc-rail .toc-item').filter({ hasText: '배경' }).click();
    await editor.waitForFunction(() => {
      const shell = document.querySelector('.document-editor-shell');
      const heading = [...document.querySelectorAll('.document-markdown-content h5')]
        .find(node => (node.textContent || '').trim() === '배경');
      if (!(shell instanceof HTMLElement) || !(heading instanceof HTMLElement)) return false;
      return Math.abs((heading.getBoundingClientRect().top - shell.getBoundingClientRect().top) - 56) < 12;
    }, null, { timeout: 5000 });

    await editor.locator('.toc-rail .toc-item').filter({ hasText: /^계약 \/ 인터페이스$/ }).click();
    await editor.waitForFunction(() => {
      const shell = document.querySelector('.document-editor-shell');
      const heading = [...document.querySelectorAll('.document-markdown-content h5')]
        .find(node => (node.textContent || '').trim() === '계약 / 인터페이스');
      if (!(shell instanceof HTMLElement) || !(heading instanceof HTMLElement)) return false;
      return Math.abs((heading.getBoundingClientRect().top - shell.getBoundingClientRect().top) - 56) < 12;
    }, null, { timeout: 5000 });

    console.log(`${executablePath ? 'packaged ' : ''}react toc navigation checks passed`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
