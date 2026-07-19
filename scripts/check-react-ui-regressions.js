const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

async function waitForEditor(app) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const page = app.windows().find(window => window.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor did not open: ${app.windows().map(window => window.url()).join(', ')}`);
}

async function dismissReleaseNotice(page) {
  const notice = page.locator('.release-notice-overlay');
  if (await notice.isVisible().catch(() => false)) {
    const confirm = notice.getByRole('button', { name: '확인' });
    if (await confirm.count()) await confirm.click();
    else await notice.click({ position: { x: 8, y: 8 } });
  }
}

async function headingShape(page) {
  return page.locator('.markdown-preview').evaluate(preview => {
    const read = selector => {
      const node = preview.querySelector(selector);
      const style = node ? getComputedStyle(node) : null;
      return style ? { size: Number.parseFloat(style.fontSize), weight: Number(style.fontWeight) } : null;
    };
    return { h1: read('h1'), h2: read('h2'), h3: read('h3'), h4: read('h4') };
  });
}

async function admonitionLabelShapes(page) {
  return page.locator('.markdown-preview .admonitionblock').evaluateAll(notes => notes.map(note => {
    const title = note.querySelector('td.icon .title');
    const icon = note.querySelector('td.icon');
    const content = note.querySelector('td.content');
    const titleRect = title?.getBoundingClientRect();
    const iconRect = icon?.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    const noteRect = note.getBoundingClientRect();
    const noteStyle = getComputedStyle(note);
    const titleStyle = title ? getComputedStyle(title) : null;
    return {
      kind: note.className,
      title: title?.textContent?.trim() || '',
      titleBottom: titleRect?.bottom || 0,
      contentTop: contentRect?.top || 0,
      overlap: titleRect && contentRect ? Math.max(0, titleRect.bottom - contentRect.top) : -1,
      borderLabelOffset: titleRect ? Math.abs((titleRect.top + titleRect.height / 2) - noteRect.top) : -1,
      borderTopColor: noteStyle.borderTopColor,
      borderTopWidth: Number.parseFloat(noteStyle.borderTopWidth),
      panelPaddingTop: noteStyle.paddingTop,
      iconHeight: iconRect?.height || 0,
      titlePosition: titleStyle?.position || '',
      titleZIndex: titleStyle?.zIndex || '',
    };
  }));
}

function cssColorAlpha(value) {
  const match = /rgba?\([^)]*?(?:,\s*([\d.]+))?\)$/.exec(String(value || ''));
  return match?.[1] === undefined ? 1 : Number(match[1]);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-ui-regressions-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-ui-regressions-user-'));
  const noteSentence = 'Security evidence uses `READ_PHONE_NUMBERS` only when the permission and runtime collection setting are both enabled.';
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# Markdown 제목\n\n## Markdown 섹션\n\n### Markdown 세부 제목\n\n본문입니다.\n');
  fs.writeFileSync(
    path.join(fixtureRoot, 'manual.adoc'),
    `= AsciiDoc 매뉴얼\n\n== 1. Eversafe Android 개요\n\n=== 1.1. Eversafe Android 소개\n\n==== 1.1.1. Endpoint 보안\n\nNOTE: ${noteSentence} ${noteSentence} ${noteSentence}\n\nIMPORTANT: Agent Copy is session-only and starts off after DocPilot restarts.\n`,
  );

  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const artifactRoot = path.join(repoRoot, '.tink', 'current', 'artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });

  try {
    const start = await app.firstWindow();
    await start.evaluate(() => {
      localStorage.setItem('docpilot:terminal-open', '0');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
    });
    await start.evaluate(root => { window.docpilot.openFolder(root); }, fixtureRoot);

    const page = await waitForEditor(app);
    await page.setViewportSize({ width: 1800, height: 1100 });
    await page.waitForSelector('.home-screen');
    await dismissReleaseNotice(page);
    await page.waitForFunction(() => document.documentElement.dataset.themePreference);

    const homeState = await page.evaluate(() => ({
      themePreference: document.documentElement.dataset.themePreference,
      terminalReopenVisible: (() => {
        const node = document.querySelector('.terminal-reopen-button');
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
      })(),
      workspaceArrow: getComputedStyle(document.querySelector('.topbar-chip-value'), '::after').content,
    }));
    check(homeState.themePreference === 'system', `fresh workspace theme must default to system: ${JSON.stringify(homeState)}`);
    check(homeState.terminalReopenVisible, 'closed terminal must expose its reopen button on Home');
    check(homeState.workspaceArrow === 'none' || homeState.workspaceArrow === '""', `workspace name must not render an arrow: ${homeState.workspaceArrow}`);

    await page.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.screenshot({ path: path.join(artifactRoot, 'home-terminal-reopen-light.png'), scale: 'css' });

    await page.locator('.workspace-file-row').filter({ hasText: 'README.md' }).click();
    await page.waitForSelector('.document-markdown-content h3');
    await page.waitForTimeout(100);
    const visualState = await page.evaluate(() => ({
      documentActive: document.querySelector('.editor-mode-toggle button.active')?.textContent?.trim() === 'Document',
      contentEditable: document.querySelector('.document-markdown-content')?.getAttribute('contenteditable'),
      editorEditableState: document.querySelector('.document-markdown-editor')?.getAttribute('data-editable'),
      safetyReason: document.querySelector('.document-markdown-editor')?.getAttribute('data-safety-reason'),
      safetyBanner: document.querySelector('.document-readonly-banner')?.textContent?.trim() || '',
      richButton: [...document.querySelectorAll('.editor-mode-toggle button')].some(button => button.textContent?.trim() === 'Rich'),
      previewButton: [...document.querySelectorAll('.editor-mode-toggle button')].some(button => button.textContent?.trim() === 'Preview'),
    }));
    check(visualState.documentActive && visualState.contentEditable === 'true', `Markdown must open in editable Document: ${JSON.stringify(visualState)}`);
    check(!visualState.richButton && !visualState.previewButton, `Markdown must expose only Source/Document modes: ${JSON.stringify(visualState)}`);
    await page.getByRole('button', { name: 'Agent Copy' }).click();
    await page.waitForSelector('.markdown-preview h3');
    const previewControls = await page.evaluate(() => {
      const toggle = document.querySelector('.line-number-toggle');
      const heading = document.querySelector('.markdown-preview h1');
      const lineStyle = heading ? getComputedStyle(heading, '::before') : null;
      const resizer = document.querySelector('.preview-width-resizer');
      const resizerStyle = resizer ? getComputedStyle(resizer, '::after') : null;
      return {
        toggleVisible: Boolean(toggle && toggle.getBoundingClientRect().width > 0),
        toggleInsideMenu: Boolean(toggle?.closest('.editor-more-menu')),
        lineDisplay: lineStyle?.display || '',
        resizerBackground: resizerStyle?.backgroundColor || '',
      };
    });
    check(previewControls.toggleVisible && !previewControls.toggleInsideMenu, `Line number toggle must be visible outside More: ${JSON.stringify(previewControls)}`);
    check(previewControls.lineDisplay === 'none', `Preview line numbers must default off: ${JSON.stringify(previewControls)}`);
    check(!['', 'transparent', 'rgba(0, 0, 0, 0)'].includes(previewControls.resizerBackground), `Preview width handle must be subtly visible at rest: ${JSON.stringify(previewControls)}`);
    const lineNumberToggle = page.locator('.line-number-toggle input');
    if (await lineNumberToggle.count()) {
      await lineNumberToggle.check();
      const longLineLabel = await page.locator('.markdown-preview h1').evaluate(heading => {
        heading.setAttribute('data-line-label', '21803-21804');
        const style = getComputedStyle(heading, '::before');
        return { display: style.display, whiteSpace: style.whiteSpace, width: Number.parseFloat(style.width) };
      });
      check(longLineLabel.display !== 'none' && longLineLabel.whiteSpace === 'nowrap' && longLineLabel.width > 40, `Long line ranges must stay on one line outside content: ${JSON.stringify(longLineLabel)}`);
      await page.screenshot({ path: path.join(artifactRoot, 'preview-toolbar-line-controls-light.png'), scale: 'css' });
      await lineNumberToggle.uncheck();
    } else {
      check(false, 'Line number toggle input is missing');
    }
    const markdownHeadings = await headingShape(page);
    check(markdownHeadings.h1?.size === 36 && markdownHeadings.h2?.size === 28 && markdownHeadings.h3?.size === 22, `Markdown heading scale is wrong: ${JSON.stringify(markdownHeadings)}`);
    check(markdownHeadings.h1?.weight <= 590 && markdownHeadings.h2?.weight <= 580 && markdownHeadings.h3?.weight <= 570, `Markdown headings are too heavy: ${JSON.stringify(markdownHeadings)}`);

    const widthState = await page.evaluate(() => {
      const stage = document.querySelector('.document-markdown-editor') || document.querySelector('.preview-document-stage');
      const visualShell = document.querySelector('.document-editor-shell');
      const visualShellStyle = visualShell ? getComputedStyle(visualShell) : null;
      const slider = document.querySelector('.preview-width-control input');
      return {
        width: Math.round(stage?.getBoundingClientRect().width || 0),
        maximum: Number(slider?.max || 0),
        available: visualShell && visualShellStyle
          ? Math.round(visualShell.clientWidth - Number.parseFloat(visualShellStyle.paddingLeft) - Number.parseFloat(visualShellStyle.paddingRight))
          : Number(slider?.max || 0),
        computedWidth: stage ? getComputedStyle(stage).width : '',
        computedMaxWidth: stage ? getComputedStyle(stage).maxWidth : '',
        inheritedPreviewWidth: stage ? getComputedStyle(stage).getPropertyValue('--preview-width') : '',
        parentClass: stage?.parentElement?.className || '',
        parentWidth: Math.round(stage?.parentElement?.getBoundingClientRect().width || 0),
        explicit: localStorage.getItem('docpilot:preview-width-explicit-v1'),
      };
    });
    check(widthState.width === Math.min(widthState.maximum, widthState.available), `fresh preview width must use the available maximum: ${JSON.stringify(widthState)}`);
    check(widthState.explicit === null, `fresh preview width must not become an explicit user reduction: ${JSON.stringify(widthState)}`);

    await page.locator('.workspace-file-row').filter({ hasText: 'manual.adoc' }).click();
    await page.waitForSelector('.markdown-preview .admonitionblock');
    await page.locator('.theme-toggle button').filter({ hasText: 'Dark' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    const darkAdmonitionLabels = await admonitionLabelShapes(page);
    check(darkAdmonitionLabels.length === 2, `NOTE and IMPORTANT fixtures must both render: ${JSON.stringify(darkAdmonitionLabels)}`);
    check(darkAdmonitionLabels.every(item => item.title && item.overlap === 0), `Dark AsciiDoc information-panel labels must not overlap their content: ${JSON.stringify(darkAdmonitionLabels)}`);
    check(darkAdmonitionLabels.every(item => item.borderLabelOffset <= 1), `Dark information-panel labels must straddle the top border: ${JSON.stringify(darkAdmonitionLabels)}`);
    await page.locator('.preview-document-stage').screenshot({ path: path.join(artifactRoot, 'asciidoc-admonition-labels-dark.png'), scale: 'css' });
    await page.locator('.theme-toggle button').filter({ hasText: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    const lightAdmonitionLabels = await admonitionLabelShapes(page);
    check(lightAdmonitionLabels.every(item => item.title && item.overlap === 0), `Light AsciiDoc information-panel labels must not overlap their content: ${JSON.stringify(lightAdmonitionLabels)}`);
    check(lightAdmonitionLabels.every(item => item.borderLabelOffset <= 1), `Light information-panel labels must straddle the top border: ${JSON.stringify(lightAdmonitionLabels)}`);
    check(lightAdmonitionLabels.every(item => item.borderTopWidth >= 1 && cssColorAlpha(item.borderTopColor) >= 0.45), `Light information-panel borders must remain visible: ${JSON.stringify(lightAdmonitionLabels)}`);
    await page.locator('.preview-document-stage').screenshot({ path: path.join(artifactRoot, 'asciidoc-admonition-labels-light.png'), scale: 'css' });
    const adocHeadings = await headingShape(page);
    check(adocHeadings.h2?.size === 36 && adocHeadings.h3?.size === 28 && adocHeadings.h4?.size === 22, `AsciiDoc heading scale is wrong: ${JSON.stringify(adocHeadings)}`);
    check(adocHeadings.h2?.weight <= 590 && adocHeadings.h3?.weight <= 580 && adocHeadings.h4?.weight <= 570, `AsciiDoc headings are too heavy: ${JSON.stringify(adocHeadings)}`);
    const koreanFont = await page.evaluate(() => ({
      family: getComputedStyle(document.querySelector('.markdown-preview h2')).fontFamily,
      loaded: [...document.fonts].some(face => face.family.includes('Noto Sans KR') && face.status === 'loaded'),
    }));
    check(koreanFont.family.includes('Noto Sans KR Variable') && koreanFont.loaded, `Korean preview font is not bundled and loaded: ${JSON.stringify(koreanFont)}`);

    const noteShape = await page.locator('.markdown-preview .admonitionblock.note').evaluate(note => {
      const content = note.querySelector('td.content');
      const code = content?.querySelector('code');
      const noteRect = note.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();
      const codeRect = code?.getBoundingClientRect();
      return {
        noteClientWidth: note.clientWidth,
        noteScrollWidth: note.scrollWidth,
        contentRight: contentRect?.right || 0,
        noteRight: noteRect.right,
        codeRight: codeRect?.right || 0,
        contentWrap: content ? getComputedStyle(content).overflowWrap : '',
        displays: {
          content: content ? getComputedStyle(content).display : '',
          code: code ? getComputedStyle(code).display : '',
        },
      };
    });
    check(noteShape.noteScrollWidth <= noteShape.noteClientWidth + 1, `AsciiDoc NOTE scrolls horizontally: ${JSON.stringify(noteShape)}`);
    check(noteShape.contentRight <= noteShape.noteRight + 1 && noteShape.codeRight <= noteShape.noteRight + 1, `AsciiDoc NOTE content escapes its box: ${JSON.stringify(noteShape)}`);
    check(noteShape.contentWrap === 'anywhere', `AsciiDoc NOTE content must wrap long tokens: ${JSON.stringify(noteShape)}`);
    check(noteShape.displays.content === 'block' && noteShape.displays.code === 'inline', `AsciiDoc NOTE must keep normal inline text flow: ${JSON.stringify(noteShape)}`);
    await page.locator('.preview-document-stage').screenshot({ path: path.join(artifactRoot, 'asciidoc-note-headings-light.png'), scale: 'css' });

    if (failures.length) throw new Error(`React UI regressions:\n- ${failures.join('\n- ')}`);
    console.log('react UI regression checks passed');
  } finally {
    await app.close().catch(() => {});
    try { execFileSync('pkill', ['-f', `bridge.js --root ${fixtureRoot}`]); } catch {}
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
