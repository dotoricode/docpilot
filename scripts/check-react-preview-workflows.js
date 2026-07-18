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
  throw new Error('React editor window did not open');
}

async function openWorkspace(app, workspace) {
  const start = await app.firstWindow();
  await start.evaluate(root => {
    localStorage.setItem('docpilot:terminal-open', '0');
    localStorage.setItem('docpilot:preview-width', '620');
    localStorage.removeItem('docpilot:preview-width-explicit-v1');
    localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
    void window.docpilot.openFolder(root);
  }, workspace);
  const editor = await waitForEditor(app);
  await editor.setViewportSize({ width: 1680, height: 980 });
  await editor.waitForSelector('.bridge-status.connected', { timeout: 15_000 });
  const notice = editor.locator('.release-notice-overlay');
  if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: '확인' }).click();
  return editor;
}

async function selectFile(editor, name) {
  await editor.locator('.workspace-file-row').filter({ hasText: name }).first().click();
  await editor.waitForSelector('.markdown-preview');
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-workflows-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-workflows-user-'));
  const markdownPath = path.join(workspace, 'README.md');
  const asciidocPath = path.join(workspace, 'guide.adoc');
  fs.writeFileSync(markdownPath, '# Markdown workflow\n\nParagraph with **bold** source.\n\n' + 'Scrollable body.\n\n'.repeat(80), 'utf8');
  fs.writeFileSync(asciidocPath, '= AsciiDoc workflow\n\nA source-faithful paragraph.\n', 'utf8');

  const launch = () => electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
  });

  let app = await launch();
  try {
    let editor = await openWorkspace(app, workspace);
    await selectFile(editor, 'README.md');
    await editor.waitForSelector('.markdown-preview h1[data-line-start="1"]');

    const defaultWidth = await editor.evaluate(() => {
      const shell = document.querySelector('.preview-shell')?.getBoundingClientRect();
      const stage = document.querySelector('.preview-document-stage')?.getBoundingClientRect();
      const outline = document.querySelector('.toc-rail')?.getBoundingClientRect();
      if (!shell || !stage || !outline) throw new Error('preview geometry unavailable');
      return {
        stage: stage.width,
        expected: Math.floor(outline.left - shell.left - 48),
        explicit: localStorage.getItem('docpilot:preview-width-explicit-v1'),
      };
    });
    assert.ok(Math.abs(defaultWidth.stage - defaultWidth.expected) <= 4, `legacy stored width must not narrow Preview: ${JSON.stringify(defaultWidth)}`);
    assert.equal(defaultWidth.explicit, null);

    const preview = editor.locator('.markdown-preview').first();
    const idleScrollbar = await preview.evaluate(node => ({
      className: node.className,
      color: getComputedStyle(node).scrollbarColor,
    }));
    assert.doesNotMatch(idleScrollbar.className, /is-scrolling/);
    assert.match(idleScrollbar.color, /transparent/);
    await preview.evaluate(node => { node.scrollTop = 320; node.dispatchEvent(new Event('scroll')); });
    await editor.waitForFunction(() => document.querySelector('.markdown-preview')?.classList.contains('is-scrolling'));
    await editor.waitForTimeout(520);
    assert.equal(await preview.evaluate(node => node.classList.contains('is-scrolling')), false, 'preview scrollbar state must return to idle');

    await editor.locator('.markdown-preview h1').first().click();
    const inline = editor.locator('.preview-inline-editor');
    await inline.waitFor();
    assert.equal(await inline.locator('textarea').inputValue(), '# Markdown workflow\n');
    await inline.locator('textarea').press('Escape');
    assert.equal(await inline.count(), 0, 'Escape must discard the edit');
    assert.equal(await editor.locator('.dirty-pill').count(), 0, 'cancel must not dirty the document');

    await editor.locator('.markdown-preview p').first().click();
    await inline.locator('textarea').fill('Paragraph with **preserved Markdown** source.\n');
    await inline.locator('textarea').press('Meta+Enter');
    await editor.waitForSelector('.dirty-pill');
    assert.match(await editor.locator('.markdown-preview p').first().innerText(), /preserved Markdown/);

    await editor.keyboard.press('Meta+Shift+C');
    const agentCopy = editor.getByRole('button', { name: 'Agent Copy' });
    assert.equal(await agentCopy.getAttribute('aria-pressed'), 'true');
    await editor.locator('.markdown-preview p').first().click();
    assert.equal(await inline.count(), 0, 'Agent Copy click must not open the source editor');
    const clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(clipboardText, /File: README\.md/);
    assert.match(clipboardText, /Lines: 3/);
    assert.match(clipboardText, /\*\*preserved Markdown\*\*/);

    await selectFile(editor, 'guide.adoc');
    await editor.waitForSelector('.adoc-preview p[data-line-start]');
    assert.equal(await agentCopy.getAttribute('aria-pressed'), 'true', 'Agent Copy must persist across documents in the session');
    await editor.keyboard.press('Meta+Shift+C');
    assert.equal(await agentCopy.getAttribute('aria-pressed'), 'false');

    await editor.locator('.adoc-preview p').first().click();
    await inline.waitFor();
    assert.equal(await inline.locator('textarea').inputValue(), 'A source-faithful paragraph.\n');
    await inline.locator('textarea').fill('A safely updated AsciiDoc paragraph.\n');
    await inline.locator('textarea').press('Meta+s');
    await editor.waitForFunction(() => !document.querySelector('.dirty-pill'));
    assert.match(fs.readFileSync(asciidocPath, 'utf8'), /safely updated AsciiDoc/);

    await editor.locator('.adoc-preview p').first().click();
    await inline.waitFor();
    fs.writeFileSync(asciidocPath, '= AsciiDoc workflow\n\nAn external revision.\n', 'utf8');
    await editor.waitForFunction(() => document.querySelector('.adoc-preview')?.textContent?.includes('external revision'), null, { timeout: 8_000 });
    await inline.getByRole('button', { name: '블록 편집 적용' }).click();
    await inline.getByRole('alert').waitFor();
    assert.match(await inline.getByRole('alert').innerText(), /원문이 바뀌어/);
    assert.match(fs.readFileSync(asciidocPath, 'utf8'), /external revision/);

    await app.close();
    app = await launch();
    editor = await openWorkspace(app, workspace);
    await selectFile(editor, 'README.md');
    assert.equal(await editor.getByRole('button', { name: 'Agent Copy' }).getAttribute('aria-pressed'), 'false', 'Agent Copy must start off after app restart');
    console.log('react preview workflow checks passed');
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
