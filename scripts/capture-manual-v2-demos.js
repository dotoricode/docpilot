const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'prototypes/manual-v2/content/demo-motion-spec.json'), 'utf8'));
const rawRoot = path.join(repoRoot, '.tink', 'current', 'artifacts', 'demo-raw');
const requestedScenario = process.argv[2] || 'all';
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function phaseMs(name, kind) {
  const phase = spec.productionScenarios[name]?.phases.find(item => item.kind === kind);
  if (!phase) throw new Error(`Missing ${kind} phase for ${name}`);
  return phase.durationMs;
}

function createFixture(name) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), `docpilot-${name}-demo-`));
  fs.mkdirSync(path.join(fixture, 'docs'));
  fs.writeFileSync(path.join(fixture, 'README.md'), [
    '# DocPilot v2.0.0',
    '',
    'A document-first workbench for local technical projects.',
    '',
    '## Release checklist',
    '',
    '- Review rendered changes',
    '- Run project commands in the terminal',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(fixture, 'alpha.md'), '# Release plan\n\nKeep the primary document visible while arranging a second reference.\n', 'utf8');
  fs.writeFileSync(path.join(fixture, 'beta.md'), '# Implementation notes\n\nDrag this tab to the right edge to create a second document pane.\n', 'utf8');
  fs.writeFileSync(path.join(fixture, 'docs', 'review.md'), '# Search evidence\n\nUnique project search evidence.\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'demo@docpilot.local'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'DocPilot Demo'], { cwd: fixture });
  execFileSync('git', ['add', '.'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'demo fixture'], { cwd: fixture });
  if (name === 'diff') {
    fs.appendFileSync(path.join(fixture, 'README.md'), [
      '',
      '## Verified release',
      '',
      'The final manual and downloadable build are ready for review.',
      '',
      '## Rollback',
      '',
      'Keep the previous deployment available until verification completes.',
    ].join('\n'), 'utf8');
  }
  return fixture;
}

async function waitForEditor(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = app.windows().find(window => window.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await wait(50);
  }
  throw new Error('DocPilot editor window did not open.');
}

async function dismissReleaseNotice(page) {
  const notice = page.locator('.release-notice-overlay');
  if (!await notice.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false)) return;
  const confirm = notice.getByRole('button', { name: '확인' });
  if (await confirm.count()) await confirm.click();
  else await notice.click({ position: { x: 8, y: 8 } });
  await notice.waitFor({ state: 'hidden' });
}

async function openFile(page, name) {
  await page.locator('.workspace-file-row').filter({ hasText: name }).first().click();
  await page.waitForSelector('.editor-mode-toggle');
}

function center(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function boxPoint(locator, label) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} geometry is unavailable.`);
  return center(box);
}

async function installDemoCursor(page, point) {
  await page.evaluate(({ x, y }) => {
    document.querySelector('[data-docpilot-demo-cursor]')?.remove();
    const cursor = document.createElement('div');
    cursor.dataset.docpilotDemoCursor = 'true';
    Object.assign(cursor.style, {
      position: 'fixed', left: `${x}px`, top: `${y}px`, width: '20px', height: '26px',
      zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-2px, -2px)',
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='26' viewBox='0 0 20 26'%3E%3Cpath d='M2 2v20l5.2-5.2 4.1 8 3.1-1.6-4-7.8H18z' fill='white' stroke='%23141619' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E")`,
      filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.35))',
    });
    document.body.appendChild(cursor);
  }, point);
  await page.mouse.move(point.x, point.y);
}

async function movePointer(page, from, to, durationMs) {
  const steps = Math.max(2, Math.round(durationMs / 34));
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
    const point = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
    await page.mouse.move(point.x, point.y);
    await page.evaluate(({ x, y }) => {
      const cursor = document.querySelector('[data-docpilot-demo-cursor]');
      if (cursor) { cursor.style.left = `${x}px`; cursor.style.top = `${y}px`; }
    }, point);
    await wait(durationMs / steps);
  }
}

async function initializeScenario(page, name) {
  await page.evaluate(({ terminalOpen }) => {
    localStorage.setItem('docpilot:theme-preference', 'dark');
    localStorage.setItem('docpilot:release-notice-seen-id', '2.0.0:r2');
    localStorage.setItem('docpilot:terminal-open', terminalOpen ? '1' : '0');
    localStorage.setItem('docpilot:workbench-pane-layout', JSON.stringify({
      type: 'split', id: 'workbench-root', orientation: 'vertical', ratio: 0.68,
      children: [{ type: 'leaf', id: 'document', kind: 'document' }, { type: 'leaf', id: 'terminal', kind: 'terminal' }],
    }));
  }, { terminalOpen: name === 'split' });
  await page.reload();
  await page.waitForSelector('.workspace-file-row');
  await dismissReleaseNotice(page);

  if (name === 'workbench') return;
  if (name === 'guide-split') {
    await openFile(page, 'alpha.md');
    await openFile(page, 'beta.md');
  } else {
    await openFile(page, 'README.md');
  }
  if (name === 'split') {
    await page.waitForSelector('.terminal-pane');
    const empty = page.locator('.terminal-empty');
    if (await empty.isVisible().catch(() => false)) await empty.click();
    await page.waitForSelector('.terminal-tab.active');
  }
  await wait(450);
}

async function runWorkbench(page, startedAt, marks) {
  const neutral = { x: 930, y: 520 };
  const target = await boxPoint(page.getByRole('button', { name: 'Quick open', exact: true }), 'Quick open');
  await installDemoCursor(page, neutral);
  await wait(phaseMs('workbench', 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, target, phaseMs('workbench', 'focus'));
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.click(target.x, target.y);
  await page.waitForSelector('.quick-open-overlay');
  await wait(550);
  const input = page.locator('.quick-open-panel input');
  await input.fill('README');
  await wait(450);
  const result = page.locator('.quick-open-row').filter({ hasText: 'README.md' }).first();
  const resultPoint = await boxPoint(result, 'Quick open result');
  await movePointer(page, target, resultPoint, 420);
  await page.mouse.click(resultPoint.x, resultPoint.y);
  await page.waitForSelector('.markdown-preview h1');
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs('workbench', 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: Math.max(marks.focusEnd, marks.actionEnd - 450) };
}

async function runGuideSplit(page, startedAt, marks) {
  const tab = page.locator('.file-tab').filter({ hasText: 'beta.md' }).first();
  const source = await boxPoint(tab, 'beta.md tab');
  const paneBox = await page.locator('.workbench-document-pane').boundingBox();
  if (!paneBox) throw new Error('Document pane geometry is unavailable.');
  const neutral = { x: paneBox.x + paneBox.width * 0.55, y: paneBox.y + paneBox.height * 0.62 };
  const activation = { x: source.x + 15, y: source.y + 8 };
  const drop = { x: paneBox.x + paneBox.width * 0.88, y: paneBox.y + paneBox.height * 0.5 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs('guide-split', 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, source, phaseMs('guide-split', 'focus'));
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.down();
  await movePointer(page, source, activation, 150);
  await movePointer(page, activation, drop, phaseMs('guide-split', 'action') - 150);
  await page.waitForSelector('.document-tab-drop-preview.edge-right');
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs('guide-split', 'preview'));
  marks.previewEnd = Date.now() - startedAt;
  await page.mouse.up();
  await page.waitForSelector('.preview-compare-horizontal');
  await wait(phaseMs('guide-split', 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: source, overviewStartMs: marks.focusEnd + 300 };
}

async function runPaneSplit(page, startedAt, marks) {
  const dragSurface = page.locator('.terminal-tabbar-drag-surface');
  const source = await boxPoint(dragSurface, 'Terminal tab bar');
  const stackBox = await page.locator('.workbench-stack').boundingBox();
  if (!stackBox) throw new Error('Workbench stack geometry is unavailable.');
  const neutral = { x: stackBox.x + stackBox.width * 0.5, y: stackBox.y + stackBox.height * 0.5 };
  const activation = { x: source.x + 16, y: source.y + 6 };
  const drop = { x: stackBox.x + stackBox.width * 0.66, y: stackBox.y + stackBox.height * 0.5 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs('split', 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, source, phaseMs('split', 'focus'));
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.down();
  await movePointer(page, source, activation, 150);
  await movePointer(page, activation, drop, phaseMs('split', 'action') - 150);
  await page.waitForFunction(() => document.querySelector('.workbench-stack')?.classList.contains('terminal-right'));
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs('split', 'preview'));
  marks.previewEnd = Date.now() - startedAt;
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.workbench-stack')?.classList.contains('terminal-right'));
  await wait(phaseMs('split', 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: source, overviewStartMs: marks.focusEnd + 300 };
}

async function runSearch(page, startedAt, marks) {
  const neutral = { x: 920, y: 500 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs('search', 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await page.keyboard.press('Meta+Shift+f');
  await page.waitForSelector('.project-search-panel');
  const input = page.locator('.project-search-input');
  const target = await boxPoint(input, 'Project search');
  await movePointer(page, neutral, target, phaseMs('search', 'focus'));
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.click(target.x, target.y);
  await page.keyboard.type('Unique project search evidence', { delay: 34 });
  await page.waitForSelector('.project-search-result');
  await wait(500);
  const result = page.locator('.project-search-result').first();
  const resultPoint = await boxPoint(result, 'Project search result');
  await movePointer(page, target, resultPoint, 450);
  await page.mouse.click(resultPoint.x, resultPoint.y);
  await page.waitForFunction(() => document.querySelector('.file-tab.active')?.textContent?.includes('review.md'));
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs('search', 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: Math.max(marks.focusEnd, marks.actionEnd - 400) };
}

async function runDiff(page, startedAt, marks) {
  const neutral = { x: 850, y: 500 };
  const toggle = page.locator('.diff-toggle').filter({ hasText: 'Diff' }).first();
  const target = await boxPoint(toggle, 'Diff toggle');
  await installDemoCursor(page, neutral);
  await wait(phaseMs('diff', 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, target, phaseMs('diff', 'focus'));
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.click(target.x, target.y);
  await page.waitForSelector('.diff-changes-rail');
  await wait(500);
  const change = page.locator('.diff-change-list > button').first();
  const changePoint = await boxPoint(change, 'Diff change');
  await movePointer(page, target, changePoint, 500);
  await page.mouse.click(changePoint.x, changePoint.y);
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs('diff', 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: marks.focusEnd + 450 };
}

async function runTerminal(page, startedAt, marks) {
  const neutral = { x: 850, y: 430 };
  const reopen = page.locator('.terminal-reopen-button');
  const target = await boxPoint(reopen, 'Open terminal');
  await installDemoCursor(page, neutral);
  await wait(phaseMs('terminal', 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, target, phaseMs('terminal', 'focus'));
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.click(target.x, target.y);
  await page.waitForSelector('.terminal-pane');
  const empty = page.locator('.terminal-empty');
  let cursor = target;
  if (await empty.isVisible().catch(() => false)) {
    const emptyPoint = await boxPoint(empty, 'New terminal');
    await movePointer(page, cursor, emptyPoint, 450);
    await page.mouse.click(emptyPoint.x, emptyPoint.y);
    cursor = emptyPoint;
  }
  await page.waitForSelector('.terminal-tab.active');
  const screen = page.locator('.terminal-xterm-host .xterm-screen');
  const screenPoint = await boxPoint(screen, 'Terminal screen');
  await movePointer(page, cursor, screenPoint, 400);
  await page.mouse.click(screenPoint.x, screenPoint.y);
  await page.keyboard.type("printf 'DocPilot terminal ready\\n'", { delay: 34 });
  await page.keyboard.press('Enter');
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs('terminal', 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: Math.max(marks.focusEnd, marks.actionEnd - 450) };
}

const scenarioRunners = {
  workbench: runWorkbench,
  'guide-split': runGuideSplit,
  split: runPaneSplit,
  search: runSearch,
  diff: runDiff,
  terminal: runTerminal,
};

async function captureScenario(name) {
  const fixture = createFixture(name);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `docpilot-${name}-demo-user-`));
  const recordDir = path.join(rawRoot, `${name}-recording`);
  fs.mkdirSync(recordDir, { recursive: true });
  const app = await electron.launch({
    args: ['.', fixture], cwd: repoRoot,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1', DOCPILOT_USER_DATA_DIR: userData },
    recordVideo: { dir: recordDir, size: spec.capture.viewport },
  });
  let video;
  let metadata;

  try {
    const page = await waitForEditor(app);
    const pageDetectedAt = Date.now();
    page.setDefaultTimeout(15_000);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1440, 900); window.center(); window.show();
    });
    await page.setViewportSize(spec.capture.viewport);
    await dismissReleaseNotice(page);
    await initializeScenario(page, name);
    video = page.video();
    if (!video) throw new Error(`Video recording did not attach for ${name}.`);

    const scenarioStartedAt = Date.now();
    const phaseMarks = { start: 0 };
    const camera = await scenarioRunners[name](page, scenarioStartedAt, phaseMarks);
    const scenarioEndedAt = Date.now();
    const postScenarioHoldMs = 450;
    await wait(postScenarioHoldMs);
    metadata = {
      scenario: name,
      pageDetectedAt,
      scenarioStartedAfterPageDetectedMs: scenarioStartedAt - pageDetectedAt,
      measuredScenarioDurationMs: scenarioEndedAt - scenarioStartedAt,
      postScenarioHoldMs,
      phaseMarks,
      camera: { ...camera, focusScale: spec.productionScenarios[name].focusScale, transitionMs: 350 },
      contract: spec.productionScenarios[name],
    };
  } finally {
    await app.close().catch(() => {});
  }

  try {
    const rawPath = path.join(rawRoot, `${name}.webm`);
    const metadataPath = path.join(rawRoot, `${name}.json`);
    await video.saveAs(rawPath);
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(JSON.stringify({ name, rawPath, metadataPath, durationMs: metadata.measuredScenarioDurationMs }));
  } finally {
    try { execFileSync('pkill', ['-f', `bridge.js --root ${fixture}`]); } catch {}
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(recordDir, { recursive: true, force: true });
  }
}

async function main() {
  fs.mkdirSync(rawRoot, { recursive: true });
  const names = requestedScenario === 'all' ? Object.keys(scenarioRunners) : [requestedScenario];
  for (const name of names) {
    if (!scenarioRunners[name]) throw new Error(`Unknown demo scenario: ${name}`);
    await captureScenario(name);
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
