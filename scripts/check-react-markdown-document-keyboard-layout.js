#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');

async function waitForEditor(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = app.windows().find(window => window.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor window did not open; windows: ${app.windows().map(window => window.url()).join(', ')}`);
}

async function dismissOverlays(page) {
  const release = page.locator('.release-notice-overlay');
  if (await release.isVisible().catch(() => false)) await release.getByRole('button', { name: '확인' }).click();
  const updateClose = page.getByRole('button', { name: '업데이트 안내 닫기' });
  if (await updateClose.isVisible().catch(() => false)) await updateClose.click();
}

async function commitImeComposition(cdp, text) {
  await cdp.send('Input.imeSetComposition', {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
  await cdp.send('Input.insertText', { text });
  await new Promise(resolve => setTimeout(resolve, 50));
}

async function commitStagedImeComposition(cdp, stages) {
  for (const text of stages) {
    await cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  }
  await cdp.send('Input.insertText', { text: stages.at(-1) || '' });
  await new Promise(resolve => setTimeout(resolve, 50));
}

async function assertToolbarIconsCentered(page, theme) {
  const toolbarGeometry = await page.locator('.document-toolbar:visible > button:has(svg)').evaluateAll(buttons => buttons.map(button => {
    const icon = button.querySelector('svg');
    const buttonRect = button.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    return {
      label: button.getAttribute('aria-label'),
      width: buttonRect.width,
      height: buttonRect.height,
      centerDeltaX: (buttonRect.left + buttonRect.width / 2) - (iconRect.left + iconRect.width / 2),
      centerDeltaY: (buttonRect.top + buttonRect.height / 2) - (iconRect.top + iconRect.height / 2),
    };
  }));
  for (const geometry of toolbarGeometry) {
    assert.equal(geometry.width, 30, `${theme}: ${geometry.label} toolbar button must keep a 30px square hit area`);
    assert.equal(geometry.height, 30, `${theme}: ${geometry.label} toolbar button must keep a 30px square hit area`);
    assert.ok(Math.abs(geometry.centerDeltaX) <= 0.5, `${theme}: ${geometry.label} icon must be horizontally centered: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.centerDeltaY) <= 0.5, `${theme}: ${geometry.label} icon must be vertically centered: ${JSON.stringify(geometry)}`);
  }
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-document-keyboard-layout-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-document-keyboard-layout-user-'));
  const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n');
  fs.writeFileSync(path.join(workspace, 'layout.md'), `# Layout\n\n${paragraphs}\n`, 'utf8');
  fs.writeFileSync(path.join(workspace, 'keyboard.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'bullet.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'ordered.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'syntax.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'ime-bullet.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'ime-bullet-marker.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'ime-quote.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'ime-pipe-quote.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'ime-heading.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'ime-ordered.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'ime-task.md'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'ime-literal.md'), '\\- literal', 'utf8');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });

  try {
    const start = await app.firstWindow();
    await start.evaluate(root => {
      localStorage.setItem('docpilot:terminal-open', '1');
      localStorage.setItem('docpilot:terminal-orientation', 'vertical');
      localStorage.setItem('docpilot:terminal-size', '260');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
      void window.docpilot.openFolder(root);
    }, workspace);

    const page = await waitForEditor(app);
    const cdp = await page.context().newCDPSession(page);
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.waitForSelector('.home-screen');
    await dismissOverlays(page);
    await page.locator('.workspace-file-row[title="layout.md"]').click();
    await page.waitForSelector('.terminal-pane');
    const document = page.locator('.document-markdown-content[contenteditable="true"]:visible');
    await document.waitFor();
    const documentTypography = await document.evaluate(node => {
      const paragraph = node.querySelector('p');
      const heading = node.querySelector('h1');
      return {
        bodyFamily: getComputedStyle(node).fontFamily,
        bodyWeight: paragraph ? getComputedStyle(paragraph).fontWeight : '',
        headingFamily: heading ? getComputedStyle(heading).fontFamily : '',
        headingWeight: heading ? getComputedStyle(heading).fontWeight : '',
      };
    });
    assert.match(documentTypography.bodyFamily, /DM Sans Variable.*Noto Sans KR Variable/, 'Document body must use the public manual font stack');
    assert.equal(documentTypography.bodyWeight, '400', 'Document body must use the public manual regular weight');
    assert.match(documentTypography.headingFamily, /Space Grotesk Variable.*Noto Sans KR Variable/, 'Document headings must use the public manual heading stack');
    assert.equal(documentTypography.headingWeight, '590', 'Document headings must use the public manual heading weight');
    const shell = page.locator('.document-editor-shell');
    await shell.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await document.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    const slashMenu = page.getByRole('listbox', { name: '블록 추가' });
    await slashMenu.waitFor();

    const geometry = await page.evaluate(() => {
      const menu = document.querySelector('.document-slash-menu');
      const editorShell = document.querySelector('.document-editor-shell');
      const terminal = document.querySelector('.terminal-pane');
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const caret = range?.getBoundingClientRect();
      if (!(menu instanceof HTMLElement) || !(editorShell instanceof HTMLElement) || !(terminal instanceof HTMLElement) || !caret) {
        throw new Error('slash-menu geometry unavailable');
      }
      const menuRect = menu.getBoundingClientRect();
      const shellRect = editorShell.getBoundingClientRect();
      const terminalRect = terminal.getBoundingClientRect();
      return {
        menuTop: Math.round(menuRect.top),
        menuBottom: Math.round(menuRect.bottom),
        shellBottom: Math.round(shellRect.bottom),
        terminalTop: Math.round(terminalRect.top),
        caretTop: Math.round(caret.top),
      };
    });
    const visibleBottom = Math.min(geometry.shellBottom, geometry.terminalTop);
    assert.ok(geometry.menuBottom <= visibleBottom - 8, `slash menu must stay above the terminal: ${JSON.stringify(geometry)}`);
    const availableAbove = geometry.caretTop;
    const availableBelow = visibleBottom - geometry.caretTop;
    assert.ok(
      availableAbove > availableBelow ? geometry.menuTop < geometry.caretTop : geometry.menuTop > geometry.caretTop,
      `slash menu must open toward the larger visible area: ${JSON.stringify(geometry)}`,
    );
    await page.screenshot({ path: path.join(artifactRoot, 'markdown-slash-menu-above-terminal.png'), scale: 'css' });
    await page.keyboard.press('Escape');

    await page.locator('.workspace-file-row[title="keyboard.md"]').click();
    await document.waitFor();
    assert.equal(
      await document.locator('[data-placeholder]').count(),
      0,
      'Document mode must not render the Agent Copy-style blue empty-block prompt',
    );
    for (const label of ['본문', '제목 1', '제목 2', '제목 3', '글머리 목록', '번호 목록', '체크리스트', '인용', '링크', '이미지']) {
      assert.equal(
        await page.getByRole('button', { name: label, exact: true }).locator('svg.lucide').count(),
        1,
        `${label} must use the same Lucide icon as Orca`,
      );
    }
    for (const theme of ['Dark', 'Light']) {
      await page.locator('.theme-toggle button').filter({ hasText: theme }).click();
      await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme.toLowerCase());
      await assertToolbarIconsCentered(page, theme);
      await page.locator('.document-toolbar:visible').screenshot({
        path: path.join(artifactRoot, `markdown-document-toolbar-${theme.toLowerCase()}.png`),
        scale: 'css',
      });
    }
    const documentEmptyBlock = document.locator('p').first();
    await documentEmptyBlock.hover();
    assert.equal(
      await documentEmptyBlock.evaluate(node => getComputedStyle(node).backgroundColor),
      'rgba(0, 0, 0, 0)',
      'Document mode must not show Agent Copy block highlighting',
    );
    await page.screenshot({ path: path.join(artifactRoot, 'markdown-document-orca-toolbar.png'), scale: 'css' });
    await document.click();
    for (let level = 1; level <= 3; level += 1) {
      await page.keyboard.type(`${'#'.repeat(level)} `);
      await page.keyboard.type(`Heading ${level}`);
      assert.equal(await document.locator(`h${level}`).last().textContent(), `Heading ${level}`);
      await page.keyboard.press('Enter');
    }

    await page.locator('.workspace-file-row[title="bullet.md"]').click();
    await document.waitFor();
    await shell.evaluate(node => { node.scrollTop = 0; });
    await document.locator('p').first().click();
    await page.keyboard.type('- ');
    const emptyBulletShape = await page.evaluate(() => {
      const editor = document.activeElement;
      const item = editor?.matches('.document-markdown-content')
        ? editor.querySelector('ul:not([data-type="taskList"]) > li')
        : null;
      const toolbar = editor?.closest('.document-markdown-editor')?.querySelector('.document-toolbar');
      if (!(item instanceof HTMLElement) || !(toolbar instanceof HTMLElement)) return null;
      const style = getComputedStyle(item);
      const marker = getComputedStyle(item, '::marker');
      return {
        itemRect: item.getBoundingClientRect().toJSON(),
        toolbarRect: toolbar.getBoundingClientRect().toJSON(),
        height: item.getBoundingClientRect().height,
        listStylePosition: style.listStylePosition,
        listStyleType: style.listStyleType,
        markerColor: marker.color,
        markerContent: marker.content,
        markerFontSize: marker.fontSize,
      };
    });
    assert.ok(emptyBulletShape, '`- ` must immediately create a bullet list in the focused editor');
    assert.equal(emptyBulletShape.listStyleType, 'disc', `empty bullet must expose a disc marker: ${JSON.stringify(emptyBulletShape)}`);
    assert.ok(emptyBulletShape.height >= 20, `empty bullet must retain a visible line box: ${JSON.stringify(emptyBulletShape)}`);
    assert.ok(
      emptyBulletShape.itemRect.y >= emptyBulletShape.toolbarRect.y + emptyBulletShape.toolbarRect.height,
      `empty bullet must remain below the sticky toolbar: ${JSON.stringify(emptyBulletShape)}`,
    );
    await page.screenshot({
      path: path.join(artifactRoot, 'markdown-empty-bullet-marker.png'),
      scale: 'css',
      clip: {
        x: Math.max(0, emptyBulletShape.itemRect.x - 48),
        y: Math.max(0, emptyBulletShape.itemRect.y - 8),
        width: Math.min(640, page.viewportSize().width - Math.max(0, emptyBulletShape.itemRect.x - 48)),
        height: emptyBulletShape.itemRect.height + 16,
      },
    });
    await page.keyboard.type('Parent');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Child');
    assert.equal(await document.locator('ul > li > ul > li').count(), 1, 'Tab must indent the current bullet item');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await document.locator('ul > li > ul > li').count(), 0, 'Shift+Tab must outdent the current bullet item');
    assert.equal(await document.locator('ul > li').count(), 2, 'outdented bullet items must remain siblings');

    await page.locator('.workspace-file-row[title="ordered.md"]').click();
    await document.waitFor();
    await document.click();
    await page.keyboard.type('1. ');
    assert.equal(
      await page.evaluate(() => {
        const editor = document.activeElement;
        const item = editor?.matches('.document-markdown-content') ? editor.querySelector('ol > li') : null;
        return item ? getComputedStyle(item).listStyleType : null;
      }),
      'decimal',
      '`1. ` must immediately expose a visible decimal marker before body text is typed',
    );
    await page.keyboard.type('Parent');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Child');
    assert.equal(await document.locator('ol > li > ol > li').count(), 1, 'Tab must indent the current numbered item');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await document.locator('ol > li > ol > li').count(), 0, 'Shift+Tab must outdent the current numbered item');
    assert.equal(await document.locator('ol > li').count(), 2, 'outdented numbered items must remain siblings');

    await page.locator('.workspace-file-row[title="ime-bullet-marker.md"]').click();
    await document.waitFor();
    await document.click();
    await commitStagedImeComposition(cdp, ['-', '- ']);
    assert.equal(await document.locator('ul:not([data-type="taskList"]) > li').count(), 1, 'IME-staged `- ` must immediately create a bullet list');
    await cdp.send('Input.insertText', { text: '한글' });
    assert.equal(await document.locator('ul:not([data-type="taskList"]) > li').last().textContent(), '한글', 'IME-staged bullet must accept following Korean text');

    await page.locator('.workspace-file-row[title="syntax.md"]').click();
    await document.waitFor();
    await document.click();
    await page.keyboard.type('> ');
    await page.keyboard.type('Quoted');
    assert.equal(await document.locator('blockquote').last().textContent(), 'Quoted', '`> ` must create a quote block');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('| ');
    await page.keyboard.type('Pipe quoted');
    assert.equal(
      await document.locator('blockquote').last().textContent(),
      'Pipe quoted',
      `\`| \` must create the same blockquote as \`> \`; DOM: ${await document.innerHTML()}`,
    );
    assert.equal(await document.locator('table').count(), 0, '`| ` must never create a Markdown table');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.document-readonly-banner').count(), 0, 'pipe-created blockquote must remain safely editable');

    await page.locator('.agent-copy-toggle').click();
    const agentCopyPreview = page.locator('.markdown-preview.agent-copy-active');
    await agentCopyPreview.waitFor();
    const agentCopyBlock = agentCopyPreview.locator('blockquote').first();
    await agentCopyBlock.click();
    const pickedAgentCopyBlock = agentCopyPreview.locator('.preview-picked');
    await pickedAgentCopyBlock.waitFor();
    assert.notEqual(
      await pickedAgentCopyBlock.evaluate(node => getComputedStyle(node).backgroundColor),
      'rgba(0, 0, 0, 0)',
      'blue block highlighting must be reserved for Agent Copy mode',
    );
    await page.locator('.agent-copy-toggle').click();

    await page.locator('.workspace-file-row[title="ime-bullet.md"]').click();
    await document.waitFor();
    await document.click();
    await commitImeComposition(cdp, '- 한글');
    assert.equal(await document.locator('ul > li').last().textContent(), '한글', 'IME-composed `- ` must create a bullet list');

    await page.locator('.workspace-file-row[title="ime-quote.md"]').click();
    await document.waitFor();
    await document.click();
    await commitImeComposition(cdp, '> 한글');
    assert.equal(await document.locator('blockquote').last().textContent(), '한글', 'IME-composed `> ` must create a quote block');

    await page.locator('.workspace-file-row[title="ime-pipe-quote.md"]').click();
    await document.waitFor();
    await document.click();
    await commitImeComposition(cdp, '| 한글');
    assert.equal(await document.locator('blockquote').last().textContent(), '한글', 'IME-composed `| ` must create a blockquote and preserve text');
    assert.equal(await document.locator('table').count(), 0, 'IME-composed `| ` must never create a table');

    await page.locator('.workspace-file-row[title="ime-heading.md"]').click();
    await document.waitFor();
    await document.click();
    await commitImeComposition(cdp, '## 한글 제목');
    assert.equal(await document.locator('h2').last().textContent(), '한글 제목', 'IME-composed heading marker must create its heading level');

    await page.locator('.workspace-file-row[title="ime-ordered.md"]').click();
    await document.waitFor();
    await document.click();
    await commitImeComposition(cdp, '3. 세 번째');
    assert.equal(await document.locator('ol').first().getAttribute('start'), '3', 'IME-composed numbered marker must preserve its start number');
    assert.equal(await document.locator('ol > li').last().textContent(), '세 번째', 'IME-composed numbered marker must preserve text');

    await page.locator('.workspace-file-row[title="ime-task.md"]').click();
    await document.waitFor();
    await document.click();
    await commitImeComposition(cdp, '- [x] 완료');
    assert.equal(await document.locator('ul[data-type="taskList"] li[data-checked="true"]').last().textContent(), '완료', 'IME-composed task marker must preserve checked state and text');

    await page.locator('.workspace-file-row[title="ime-literal.md"]').click();
    await document.waitFor();
    const literalParagraph = document.locator('p').first();
    await literalParagraph.click();
    await page.keyboard.press('End');
    await commitImeComposition(cdp, '한글');
    assert.equal(await document.locator('ul').count(), 0, 'IME text after an existing escaped marker must not rewrite the paragraph');
    assert.equal(await literalParagraph.textContent(), '- literal한글', 'escaped marker text and composed suffix must be preserved');

    console.log('react Markdown Document keyboard, IME syntax, icon, and terminal-boundary checks passed');
  } finally {
    await app.close().catch(() => {});
    try { execFileSync('pkill', ['-f', `bridge.js --root ${workspace}`]); } catch {}
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
