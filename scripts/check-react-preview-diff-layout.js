const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
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

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-preview-diff-'));
  const fileName = 'diff-layout.md';
  const filePath = path.join(fixtureRoot, fileName);
  const before = [
    '---',
    'id: ISS-CORDOVA-004',
    'title: iOS native SDK API 불일치',
    'status: Resolved',
    '---',
    '',
    '# ISS-CORDOVA-004 — iOS native SDK API 불일치',
    '',
    '## 배경',
    '',
    '`eversafe_cordova_from_docs` 재구현 과정에서 공개 문서와 실제 SDK 헤더를 대조했다.',
    '',
    '## 불일치 상세',
    '',
    '### #1 — `initializeWithBaseUrl:appId:userInfo:delegate:` → `delegate:` 파라미터 없음',
    '',
    '| 구분 | 시그니처 |',
    '|---|---|',
    '| 문서·예시 코드 | `initializeWithBaseUrl:appId:userInfo:delegate:` |',
    '| 실제 SDK (`Eversafe.h`) | `- (void)initializeWithBaseUrl:(NSString *)baseUrl appId:(NSString *)appId userInfo:(NSDictionary *)userInfo;` |',
    '| 네이티브 SDK·서버 | additionalInfo 키·네이티브 정책 매핑, threat/error 코드 정보 링크, `.aar` / `.xcframework` + Dynamic Module 삽입 방식, plugin id `eversafe-cordova-plugin`, clobber target `cordova.plugins.EversafePlugin`, `eversafe.json` 키 |',
    '',
    '`delegate:` 파라미터가 존재하지 않는다. delegate 는 별도 프로퍼티로 설정해야 한다.',
    '',
    '**해결:** `delegate:` 파라미터를 제거하고, `setSubscriber` 단계에서 `[[Eversafe sharedInstance] setDelegate:self];` 를 호출한다.',
    '',
    '### #2 — `getVerificationToken` 시그니처',
    '',
    'block 파라미터는 `result` 와 `verificationToken` 을 사용한다.',
    '',
  ].join('\n');
  const after = before.replace('를 호출한다.', '를 호출해야한다.');

  fs.writeFileSync(filePath, before, 'utf8');
  run('git', ['init'], fixtureRoot);
  run('git', ['config', 'user.email', 'docpilot@example.test'], fixtureRoot);
  run('git', ['config', 'user.name', 'DocPilot Test'], fixtureRoot);
  run('git', ['add', fileName], fixtureRoot);
  run('git', ['commit', '-m', 'baseline'], fixtureRoot);
  fs.writeFileSync(filePath, after, 'utf8');

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
    await editor.setViewportSize({ width: 1680, height: 1040 });
    await editor.waitForSelector('.workspace-file-row');
    await editor.locator('.workspace-file-row').filter({ hasText: fileName }).first().click();
    await editor.waitForSelector('.markdown-preview h1');
    await editor.locator('.diff-toggle').filter({ hasText: 'Diff' }).first().click();
    await editor.waitForSelector('.preview-diff-block.change-old');
    await editor.waitForSelector('.preview-diff-block.same');

    const screenshotPath = path.join(os.tmpdir(), 'docpilot-preview-diff-layout.png');
    await editor.screenshot({ path: screenshotPath, fullPage: false });

    const layout = await collectPreviewDiffLayout(editor);

    assertPreviewDiffLayout(layout, 'unified');

    await editor.locator('.diff-toggle').filter({ hasText: '분할' }).first().click();
    await editor.waitForSelector('.preview-diff-split .preview-diff-block.split');
    const splitScreenshotPath = path.join(os.tmpdir(), 'docpilot-preview-diff-split-layout.png');
    await editor.screenshot({ path: splitScreenshotPath, fullPage: false });
    const splitLayout = await collectPreviewDiffLayout(editor);

    assertPreviewDiffLayout(splitLayout, 'split');

    console.log(`react preview diff layout checks passed (${screenshotPath}, ${splitScreenshotPath})`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function collectPreviewDiffLayout(editor) {
  return editor.locator('.preview-diff-block').evaluateAll(blocks => blocks.map(block => {
      const blockRect = block.getBoundingClientRect();
      const mark = block.querySelector('.preview-diff-mark');
      const rendered = block.querySelector('.preview-diff-rendered');
      const tokenRects = Array.from(block.querySelectorAll('.preview-diff-token')).map(token => {
        const rect = token.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          text: token.textContent?.slice(0, 40) || '',
        };
      });
      const markRect = mark?.getBoundingClientRect();
      const renderedRect = rendered?.getBoundingClientRect();
      return {
        className: block.className,
        blockTop: blockRect.top,
        blockBottom: blockRect.bottom,
        blockLeft: blockRect.left,
        blockWidth: blockRect.width,
        markRight: markRect ? markRect.right : 0,
        renderedLeft: renderedRect ? renderedRect.left : 0,
        renderedWidth: renderedRect ? renderedRect.width : 0,
        renderedHeight: renderedRect ? renderedRect.height : 0,
        tokenRects,
      };
  }));
}

function assertPreviewDiffLayout(layout, mode) {
  assert(layout.some(row => row.className.includes('same')), `${mode}: preview diff must keep gray unchanged context rows`);
  assert(layout.some(row => row.className.includes('change-old')), `${mode}: preview diff must render old side of changed block`);
  assert(layout.some(row => row.className.includes('change-new')), `${mode}: preview diff must render new side of changed block`);

  for (const row of layout) {
    const minWidth = mode === 'split' ? Math.min(120, row.blockWidth * 0.42) : Math.min(240, row.blockWidth * 0.55);
    assert(row.renderedLeft > row.markRight, `${mode}: diff text overlaps mark gutter: ${JSON.stringify(row)}`);
    assert(row.renderedWidth > minWidth, `${mode}: diff text column collapsed: ${JSON.stringify(row)}`);
    assert(row.renderedHeight < 520, `${mode}: diff row is unexpectedly tall, possible vertical text wrap: ${JSON.stringify(row)}`);
    assert(row.tokenRects.every(token => token.left >= row.renderedLeft - 1), `${mode}: token escapes left of rendered column: ${JSON.stringify(row)}`);
    assert(row.tokenRects.every(token => token.right <= row.renderedLeft + row.renderedWidth + 2), `${mode}: token escapes right of rendered column: ${JSON.stringify(row)}`);
  }
  const sorted = [...layout].sort((left, right) => left.blockTop - right.blockTop || left.blockLeft - right.blockLeft);
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1];
    const current = sorted[index];
    const sameColumn = Math.abs(prev.blockLeft - current.blockLeft) < 8;
    if (!sameColumn) continue;
    assert(current.blockTop >= prev.blockBottom - 1, `${mode}: preview diff rows overlap vertically: ${JSON.stringify({ prev, current })}`);
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
