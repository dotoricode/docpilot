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
    '`example_security_plugin_from_docs` 재구현 과정에서 공개 문서와 실제 SDK 헤더를 대조했다.',
    '',
    '## 불일치 상세',
    '',
    '### #1 — `initializeWithBaseUrl:appId:userInfo:delegate:` → `delegate:` 파라미터 없음',
    '',
    '| 구분 | 시그니처 |',
    '|---|---|',
    '| 문서·예시 코드 | `initializeWithBaseUrl:appId:userInfo:delegate:` |',
    '| 실제 SDK (`ExampleSecuritySDK.h`) | `- (void)initializeWithBaseUrl:(NSString *)baseUrl appId:(NSString *)appId userInfo:(NSDictionary *)userInfo;` |',
    '| 네이티브 SDK·서버 | exampleInfo 키·정책 매핑, 상태 코드 정보 링크, `.aar` / `.xcframework` 삽입 방식, plugin id `example-security-plugin`, clobber target `cordova.plugins.ExampleSecurityPlugin`, `example-security.json` 키 |',
    '',
    '`delegate:` 파라미터가 존재하지 않는다. delegate 는 별도 프로퍼티로 설정해야 한다.',
    '',
    '**해결:** `delegate:` 파라미터를 제거하고, `setSubscriber` 단계에서 `[[ExampleSecuritySDK sharedInstance] setDelegate:self];` 를 호출한다.',
    '',
    '### #2 — `getVerificationToken` 시그니처',
    '',
    'block 파라미터는 `result` 와 `verificationToken` 을 사용한다.',
    '',
    '## 읽는 순서',
    '',
    '[requirements/overview.md](./requirements/overview.md) — 왜 이 플러그인이 필요한가. [requirements/features.md](./requirements/features.md) — 무엇을 제공하는가(제품 기능). [requirements/use-cases.md](./requirements/use-cases.md) — 어떻게 동작해야 하는가(L2 시나리오). [specification/dart-api.md](./specification/dart-api.md) — 공개 Dart API 계약(L1.5 + L2 대원칙). [specification/constants.md](./specification/constants.md) — 고정 키·코드·매핑(L1). [specification/app-server-contract.md](./specification/app-server-contract.md) — App Server 연동 데이터 규약(L1). [specification/native-sdk.md](./specification/native-sdk.md) — SDK 삽입 방식(L1). [references/writing-guide.md](./references/writing-guide.md) — 요구사항·계약·구현 사례 분류 원칙. [references/flutter-plugin-basics.md](./references/flutter-plugin-basics.md) — Flutter 플러그인 일반 배경지식. [references/implementation-cases.md](./references/implementation-cases.md) — 요구사항으로 고정하지 않는 구현 사례 모음. [references/human-decision-points.md](./references/human-decision-points.md) — 코드·매뉴얼 대조 후 사람의 판단이 필요한 항목. [adr/](./adr/) — 설계 결정과 대안.',
    '',
    '`docs/ ├─ requirements/ 왜 / 무엇 / 어떻게 동작 (L2) ├─ specification/ 협상 불가능한 고정 값 (L1 / L1.5) ├─ adr/ 설계 결정과 대안 └─ references/ Flutter 일반 배경지식`',
    '',
    '| 디렉터리 | 문서 역할 | 넣을 내용 | 넣지 않을 내용 | |---|---|---|---| | requirements/ | 사용자 관찰 동작과 완료 기준 | 기능 목적, 시나리오, 검증 요구사항 | 브릿지 방식, 내부 캐시 구조 | | specification/ | 바꾸면 호환성이 깨지는 계약 | 공개 API, 상수, result 매핑, 서버 데이터 형식, SDK 삽입 규약 | 발생 배경, 대안 비교 | | adr/ | 왜 특정 설계 결정을 했는지 | Context, Decision, Alternatives, Consequences | 구현 절차, 테스트 로그 원문 | | references/ | 보조 설명과 작성 가이드 | Flutter 배경지식, 문서 작성 분류 예시, 구현 사례 후보 | 제품 계약의 유일한 출처 |',
    '',
  ].join('\n');
  const after = before
    .replace('를 호출한다.', '를 호출해야한다.')
    .replaceAll('specification/', 'specs/')
    .replace('[adr/](./adr/) — 설계 결정과 대안.', '[specs/native-result-normalization.md](./specs/native-result-normalization.md) — native result 정규화 설계 결정. [testcases/test-checklist.md](./testcases/test-checklist.md) — 완성 후 동일 동작 판정.')
    .replace('`docs/ ├─ requirements/ 왜 / 무엇 / 어떻게 동작 (L2) ├─ specs/ 협상 불가능한 고정 값 (L1 / L1.5) ├─ adr/ 설계 결정과 대안 └─ references/ Flutter 일반 배경지식`', '`docs/ ├─ requirements/ 무엇을 만족해야 하는가 (FR / NFR) ├─ specs/ 어떻게 동작하고 왜 그렇게 설계했는가 (SPEC) ├─ testcases/ 어떻게 검증하는가 (TC) └─ references/ 구현 사례·미결 사항·보조 설명`')
    .replace('| requirements/ | 사용자 관찰 동작과 완료 기준 | 기능 목적, 시나리오, 검증 요구사항 | 브릿지 방식, 내부 캐시 구조 | | specs/ | 바꾸면 호환성이 깨지는 계약 | 공개 API, 상수, result 매핑, 서버 데이터 형식, SDK 삽입 규약 | 발생 배경, 대안 비교 | | adr/ | 왜 특정 설계 결정을 했는지 | Context, Decision, Alternatives, Consequences | 구현 절차, 테스트 로그 원문 | | references/ | 보조 설명과 작성 가이드 | Flutter 배경지식, 문서 작성 분류 예시, 구현 사례 후보 | 제품 계약의 유일한 출처 |', '| requirements/ | 제품이 만족해야 하는 요구사항 | 기능 목적, 사용자 관찰 동작, 성능·호환성·보안 조건 | 브릿지 방식, 내부 캐시 구조 | | specs/ | 바꾸면 호환성이 깨지는 계약과 설계 결정 | 공개 API, 상수, result 매핑, 서버 데이터 형식, SDK 삽입 규약, 결정 배경 | 검증 절차 원문, 임시 구현 사례 | | testcases/ | 요구사항·계약 충족 여부를 판정하는 검증 기준 | 동일 동작 체크리스트, 관찰해야 할 결과 | 제품 요구사항의 유일한 출처 | | references/ | 보조 설명과 임시 보관소 | Flutter 배경지식, 문서 작성 분류 예시, 구현 사례 후보, 미결 판단 항목 | 확정된 제품 계약의 유일한 출처 |');

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
    await editor.waitForSelector('.workspace-file-row');
    const releaseNotice = editor.locator('.release-notice-overlay');
    if (await releaseNotice.count()) {
      await releaseNotice.locator('button').filter({ hasText: '확인' }).click();
    }
    await editor.locator('.workspace-file-row').filter({ hasText: fileName }).first().click();
    await editor.waitForSelector('.markdown-preview h1');
    await editor.locator('.diff-toggle').filter({ hasText: 'Diff' }).first().click();
    await editor.waitForSelector('.preview-diff-block.change-old');
    await editor.waitForSelector('.preview-diff-block.same');

    const viewports = [
      { width: 1680, height: 1040 },
      { width: 1280, height: 900 },
      { width: 980, height: 820 },
    ];
    const screenshots = [];

    for (const viewport of viewports) {
      await editor.setViewportSize(viewport);
      await editor.waitForSelector('.preview-diff-block.change-old');
      await editor.waitForSelector('.preview-diff-block.same');

      const screenshotPath = path.join(os.tmpdir(), `docpilot-preview-diff-layout-${viewport.width}.png`);
      await editor.screenshot({ path: screenshotPath, fullPage: false });
      screenshots.push(screenshotPath);

      const layout = await collectPreviewDiffLayout(editor);
      assertPreviewDiffLayout(layout, `unified ${viewport.width}`);
      await assertPreviewDiffShape(editor, `unified ${viewport.width}`);
      await assertMinimalInlineHighlight(editor, `unified ${viewport.width}`);

      await editor.locator('.diff-toggle').filter({ hasText: '좌우 비교' }).first().click();
      await editor.waitForSelector('.preview-diff-split .preview-diff-block.split');
      await assertSplitDiffScrollSync(editor, `split ${viewport.width}`);
      const splitScreenshotPath = path.join(os.tmpdir(), `docpilot-preview-diff-split-layout-${viewport.width}.png`);
      await editor.screenshot({ path: splitScreenshotPath, fullPage: false });
      screenshots.push(splitScreenshotPath);
      const splitLayout = await collectPreviewDiffLayout(editor);

      assertPreviewDiffLayout(splitLayout, `split ${viewport.width}`);
      await assertPreviewDiffShape(editor, `split ${viewport.width}`);
      await assertMinimalInlineHighlight(editor, `split ${viewport.width}`);

      await editor.locator('.diff-toggle').filter({ hasText: '좌우 비교' }).first().click();
      await editor.waitForSelector('.preview-diff-page .preview-diff-block');
    }

    console.log(`react preview diff layout checks passed (${screenshots.join(', ')})`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function assertSplitDiffScrollSync(editor, mode) {
  const scrollState = await editor.evaluate(async () => {
    const lists = Array.from(document.querySelectorAll('.preview-diff-split .preview-diff-list'));
    if (lists.length !== 2) return { ok: false, reason: `expected 2 split lists, got ${lists.length}` };
    const [left, right] = lists;
    const target = Math.min(260, Math.max(0, left.scrollHeight - left.clientHeight));
    left.scrollTop = target;
    left.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    return {
      ok: Math.abs(left.scrollTop - right.scrollTop) <= 1,
      left: left.scrollTop,
      right: right.scrollTop,
      target,
      leftMax: left.scrollHeight - left.clientHeight,
      rightMax: right.scrollHeight - right.clientHeight,
    };
  });
  assert(scrollState.ok, `${mode}: split diff scroll should stay synchronized: ${JSON.stringify(scrollState)}`);
}

async function collectPreviewDiffLayout(editor) {
  return editor.locator('.preview-diff-block').evaluateAll(blocks => blocks.map(block => {
      const blockRect = block.getBoundingClientRect();
      const mark = block.querySelector('.preview-diff-mark');
      const rendered = block.querySelector('.preview-diff-rendered');
      const lineStyle = getComputedStyle(block, '::before');
      const lineLeft = blockRect.left + Number.parseFloat(lineStyle.left || '0');
      const lineWidth = Number.parseFloat(lineStyle.width || '0');
      const tokenRects = Array.from(block.querySelectorAll('.preview-diff-token')).flatMap(token => {
        const rects = Array.from(token.getClientRects());
        return rects.map(rect => ({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          text: token.textContent?.slice(0, 40) || '',
        }));
      });
      const markRect = mark?.getBoundingClientRect();
      const renderedRect = rendered?.getBoundingClientRect();
      return {
        className: block.className,
        blockTop: blockRect.top,
        blockBottom: blockRect.bottom,
        blockLeft: blockRect.left,
        blockRight: blockRect.right,
        blockWidth: blockRect.width,
        lineContent: lineStyle.content || '',
        lineLeft,
        lineRight: lineLeft + lineWidth,
        lineWidth,
        markRight: markRect ? markRect.right : 0,
        markText: mark?.textContent || '',
        renderedLeft: renderedRect ? renderedRect.left : 0,
        renderedWidth: renderedRect ? renderedRect.width : 0,
        renderedHeight: renderedRect ? renderedRect.height : 0,
        tokenRects,
      };
  }));
}

function assertPreviewDiffLayout(layout, mode) {
  assert(layout.some(row => row.className.includes('same')), `${mode}: preview diff must keep unchanged full-document rows`);
  assert(layout.some(row => row.className.includes('change-old')), `${mode}: preview diff must render old side of changed block`);
  assert(layout.some(row => row.className.includes('change-new')), `${mode}: preview diff must render new side of changed block`);
  assert(layout.every(row => !row.markText.trim()), `${mode}: preview diff must not render +/- mark text: ${JSON.stringify(layout.filter(row => row.markText.trim()).slice(0, 2))}`);

  for (const row of layout) {
    const minWidth = mode.startsWith('split') ? Math.min(120, row.blockWidth * 0.42) : Math.min(240, row.blockWidth * 0.42);
    assert(row.lineContent && row.lineContent !== 'none', `${mode}: diff row line label is missing: ${JSON.stringify(row)}`);
    assert(row.lineWidth >= 20, `${mode}: diff row line label column is too narrow: ${JSON.stringify(row)}`);
    assert(row.lineLeft >= row.blockLeft - 1, `${mode}: diff row line label escapes left of row: ${JSON.stringify(row)}`);
    assert(row.lineRight <= row.renderedLeft - 4, `${mode}: diff row line label overlaps rendered text: ${JSON.stringify(row)}`);
    assert(row.lineRight <= row.blockRight + 1, `${mode}: diff row line label escapes right of row: ${JSON.stringify(row)}`);
    assert(row.markRight === 0 || row.renderedLeft > row.markRight, `${mode}: diff text overlaps mark gutter: ${JSON.stringify(row)}`);
    assert(row.renderedWidth > minWidth, `${mode}: diff text column collapsed: ${JSON.stringify(row)}`);
    assert(row.renderedHeight < 1600, `${mode}: diff row is unexpectedly tall, possible runaway vertical text wrap: ${JSON.stringify(row)}`);
    assert(row.tokenRects.every(token => token.left >= row.renderedLeft - 1), `${mode}: token escapes left of rendered column: ${JSON.stringify(row)}`);
    assert(row.tokenRects.every(token => token.right <= row.renderedLeft + row.renderedWidth + 2), `${mode}: token escapes right of rendered column: ${JSON.stringify(row)}`);
    assert(row.tokenRects.every(token => token.top >= row.blockTop - 1), `${mode}: token escapes above diff row: ${JSON.stringify(row)}`);
    assert(row.tokenRects.every(token => token.bottom <= row.blockBottom + 1), `${mode}: token escapes below diff row: ${JSON.stringify(row)}`);
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

async function assertPreviewDiffShape(editor, mode) {
  const shape = await editor.locator('.markdown-preview.diff-preview-mode').evaluate(root => ({
    markCount: root.querySelectorAll('.preview-diff-mark').length,
    headingCount: root.querySelectorAll('.preview-diff-rendered h1, .preview-diff-rendered h2, .preview-diff-rendered h3').length,
    tableCount: root.querySelectorAll('.preview-diff-rendered table').length,
    paragraphCount: root.querySelectorAll('.preview-diff-rendered p').length,
    renderedFont: getComputedStyle(root.querySelector('.preview-diff-rendered')).fontFamily,
    codeFont: getComputedStyle(root.querySelector('.preview-diff-token.code')).fontFamily,
    changedBlockNeutral: Array.from(root.querySelectorAll('.preview-diff-block.change-old, .preview-diff-block.change-new, .preview-diff-block.add, .preview-diff-block.del')).every(block => {
      const style = getComputedStyle(block);
      return style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && !style.backgroundColor.includes('74, 222, 128') && !style.backgroundColor.includes('248, 113, 113');
    }),
  }));
  assert.strictEqual(shape.markCount, 0, `${mode}: preview diff should not render mark elements`);
  assert(shape.headingCount > 0, `${mode}: preview diff should preserve heading elements: ${JSON.stringify(shape)}`);
  assert(shape.tableCount > 0, `${mode}: preview diff should preserve table elements: ${JSON.stringify(shape)}`);
  assert(shape.paragraphCount > 0, `${mode}: preview diff should preserve paragraph elements: ${JSON.stringify(shape)}`);
  assert(shape.changedBlockNeutral, `${mode}: changed blocks should use neutral block highlighting: ${JSON.stringify(shape)}`);
  assert(
    /Apple SD Gothic Neo|Noto Sans KR|Pretendard/.test(shape.renderedFont),
    `${mode}: preview diff should use Korean-readable preview font stack: ${JSON.stringify(shape)}`,
  );
  assert(
    /SF Mono|SFMono-Regular|ui-monospace/.test(shape.codeFont),
    `${mode}: preview diff code tokens should use monospace font stack: ${JSON.stringify(shape)}`,
  );
}

async function assertMinimalInlineHighlight(editor, mode) {
  const data = await editor.locator('.preview-diff-block.change-new').evaluateAll(blocks => {
    const rows = blocks.map(block => ({
      text: block.textContent || '',
      changed: Array.from(block.querySelectorAll('.preview-diff-token.changed.new')).map(token => token.textContent || ''),
      unchanged: Array.from(block.querySelectorAll('.preview-diff-token:not(.changed)')).map(token => token.textContent || ''),
    }));
    return rows;
  });
  const row = data.find(item => item.text.includes('호출해야한다'));
  assert(row, `${mode}: expected changed row containing 호출해야한다`);
  assert(row.changed.includes('해야'), `${mode}: inserted text 해야 must be the only highlighted new token: ${JSON.stringify(row)}`);
  assert(!row.changed.some(text => text.includes('호출') || text.includes('한다')), `${mode}: unchanged prefix/suffix must not be highlighted: ${JSON.stringify(row)}`);
  assert(row.unchanged.some(text => text.includes('호출')), `${mode}: unchanged prefix should remain muted text: ${JSON.stringify(row)}`);
  assert(row.unchanged.some(text => text.includes('한다')), `${mode}: unchanged suffix should remain muted text: ${JSON.stringify(row)}`);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
