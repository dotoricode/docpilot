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

async function readClipboard(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-context-diff-'));
  const filePath = path.join(workspace, 'review.md');
  fs.writeFileSync(filePath, [
    '# Review Fixture',
    '',
    '- **계약 추가 위치:** SPEC-CORDOVA-002 §3 블록 추가.',
    '',
    'Duplicate context paragraph.',
    '',
    'Duplicate context paragraph.',
    '',
    'Third context paragraph.',
    '',
    'Fourth context paragraph.',
    '',
    'Fifth context paragraph.',
    '',
    'Original diff line.',
    '',
  ].join('\n'), 'utf8');

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
      window.docpilot.openFolder(root);
      return true;
    }, workspace);

    const page = await waitForReactEditorWindow(app);
    await page.waitForSelector('.bridge-status.connected', { timeout: 15000 });
    await page.waitForSelector('.workspace-file-row', { timeout: 15000 });
    await page.locator('.workspace-file-row').filter({ hasText: 'review.md' }).first().click();
    await page.waitForSelector('.markdown-preview h1', { timeout: 15000 });
    assert.strictEqual(await page.locator('.changed-files-panel').count(), 0, 'changed files panel should not occupy default lower UI with zero reviews');

    await page.getByRole('button', { name: '편집' }).click();
    await page.locator('.cm-content').click();
    await page.waitForFunction(() => {
      const cursor = document.querySelector('.cm-cursor');
      const activeLine = document.querySelector('.cm-activeLine');
      if (!(cursor instanceof HTMLElement) || !(activeLine instanceof HTMLElement)) return false;
      const cursorStyle = getComputedStyle(cursor);
      const activeLineStyle = getComputedStyle(activeLine);
      const cursorRect = cursor.getBoundingClientRect();
      return cursorRect.height > 0
        && cursorStyle.visibility !== 'hidden'
        && cursorStyle.borderLeftWidth !== '0px'
        && activeLineStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
        && activeLineStyle.backgroundColor !== 'transparent';
    }, null, { timeout: 5000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.waitForFunction(() => document.querySelectorAll('.document-context-chip').length === 0);
    await page.getByRole('button', { name: '프리뷰' }).click();

    await page.locator('.markdown-preview li').filter({ hasText: '계약 추가 위치:' }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.document-context-chip').length === 1);
    await page.waitForSelector('.document-context-actions');
    await page.locator('.document-context-actions').getByRole('button', { name: '복사' }).click();
    const styledCopied = await readClipboard(app);
    assert(styledCopied.includes('계약 추가 위치:'), 'copy should include rendered markdown list text');
    assert(!/Range: 0-\d+/.test(styledCopied), `markdown-rendered context range should not collapse to zero: ${styledCopied}`);

    await page.evaluate(() => {
      const paragraph = [...document.querySelectorAll('.markdown-preview p')]
        .find(node => (node.textContent || '').includes('Third context paragraph.'));
      if (!paragraph || !paragraph.firstChild) throw new Error('range fixture paragraph not found');
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 0);
      range.setEnd(paragraph.firstChild, 'Third context'.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelectorAll('.document-context-chip').length === 2);

    const duplicateParagraphs = page.locator('.markdown-preview p').filter({ hasText: 'Duplicate context paragraph.' });
    await duplicateParagraphs.nth(0).click();
    await page.waitForFunction(() => document.querySelectorAll('.document-context-chip').length === 3);
    await duplicateParagraphs.nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('.document-context-chip').length === 4);
    await page.locator('.markdown-preview p').filter({ hasText: 'Fourth context paragraph.' }).first().click();
    await page.locator('.markdown-preview p').filter({ hasText: 'Fifth context paragraph.' }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.document-context-chip').length === 6);
    await page.waitForFunction(() => {
      const rail = document.querySelector('.document-context-rail');
      const chips = [...document.querySelectorAll('.document-context-chip')];
      if (!(rail instanceof HTMLElement) || chips.length !== 6) return false;
      const railStyles = getComputedStyle(rail);
      const rects = chips.map(chip => chip.getBoundingClientRect());
      return railStyles.overflowY === 'auto'
        && rail.scrollWidth <= rail.clientWidth + 1
        && rects.every((rect, index) => index === 0 || rect.top > rects[index - 1].top);
    });

    await page.locator('.document-context-actions').getByRole('button', { name: '복사' }).click();
    const allCopied = await readClipboard(app);
    assert(allCopied.includes('---'), 'all chip copy should separate multiple chips');
    assert((allCopied.match(/Duplicate context paragraph\./g) || []).length === 2, 'all chip copy should include both chips before dedupe');
    assert(allCopied.includes('Third context'), 'all chip copy should include preview range selections');
    assert(!/^Range: 0-/m.test(allCopied), `copied ranges should not all collapse to zero: ${allCopied}`);

    await page.getByRole('button', { name: '중복 제거' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.document-context-chip').length === 5);
    await page.locator('.document-context-chip').first().getByRole('button', { name: '참고 내용 제거' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.document-context-chip').length === 4);
    await page.locator('.agent-composer > textarea').fill('추가한 참고 내용으로 답해줘');
    await page.getByRole('button', { name: '보내기' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.document-context-chip').length === 0, null, { timeout: 15000 });

    fs.writeFileSync(filePath, [
      '# Review Fixture',
      '',
      '- **계약 추가 위치:** SPEC-CORDOVA-002 §3 블록 추가.',
      '',
      'Duplicate context paragraph.',
      '',
      'Duplicate context paragraph.',
      '',
      'Third context paragraph.',
      '',
      'Fourth context paragraph.',
      '',
      'Fifth context paragraph.',
      '',
      'Changed diff line.',
      '',
    ].join('\n'), 'utf8');

    await page.waitForSelector('.file-review-card', { timeout: 10000 });
    const reviewMessageText = await page.locator('.agent-message.review-result').innerText();
    assert(reviewMessageText.includes('AI가 바꾼 파일'), 'changed file review should appear inside the conversation flow');
    const reviewActionShape = await page.locator('.file-review-card footer button').first().evaluate(button => {
      const styles = getComputedStyle(button);
      return {
        text: button.textContent || '',
        whiteSpace: styles.whiteSpace,
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
      };
    });
    assert.strictEqual(reviewActionShape.text.trim(), 'diff 뷰로 확인', 'diff review button should use the revised clear label');
    assert.strictEqual(reviewActionShape.whiteSpace, 'nowrap', 'diff review button text should not wrap vertically');
    assert(!reviewActionShape.fontFamily.toLowerCase().includes('hack'), 'diff review button should use a readable UI font, not the code font');
    await page.locator('.file-review-card button').filter({ hasText: 'diff 뷰로 확인' }).click();
    await page.waitForSelector('.markdown-preview.diff-preview-mode', { timeout: 10000 });
    await page.waitForSelector('.preview-diff-block.change-new', { timeout: 10000 });
    const diffText = await page.locator('.markdown-preview.diff-preview-mode').innerText();
    assert(diffText.includes('Changed diff line.'), 'central diff should show pending review after content');
    assert(diffText.includes('Original diff line.'), 'central diff should show pending review before content');

    console.log(`${executablePath ? 'packaged ' : ''}react context and diff acceptance checks passed`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
