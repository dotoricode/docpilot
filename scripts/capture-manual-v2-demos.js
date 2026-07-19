const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'prototypes/manual-v2/content/demo-motion-spec.json'), 'utf8'));
const rawRoot = path.join(repoRoot, '.tink', 'current', 'artifacts', 'demo-raw');
const requestedScenario = process.argv[2] || 'all';
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const typingDelay = 95;

function phaseMs(name, kind) {
  const phase = spec.productionScenarios[name]?.phases.find(item => item.kind === kind);
  if (!phase) throw new Error(`Missing ${kind} phase for ${name}`);
  return phase.durationMs;
}

function longMarkdown() {
  const sections = Array.from({ length: 28 }, (_, index) => [
    `## Workflow ${String(index + 1).padStart(2, '0')}`,
    '',
    `This section explains a synthetic documentation workflow for demonstration ${index + 1}.`,
    '',
    '- Confirm the visible input.',
    '- Perform one observable action.',
    '- Record the verification signal.',
    '',
    'Verification signal: the rendered section and its outline entry stay aligned.',
  ].join('\n'));
  return ['# Public Demo Manual', '', 'A long synthetic Markdown manual with no private or company content.', '', ...sections].join('\n');
}

function longAsciiDoc() {
  const chapters = Array.from({ length: 90 }, (_, index) => [
    `== Workflow Chapter ${String(index + 1).padStart(2, '0')}`,
    '',
    `This synthetic chapter documents a public-safe workflow example ${index + 1}.`,
    '',
    '.Verification steps',
    '. Confirm the visible input.',
    '. Perform the documented action.',
    '. Check the observable result.',
    '',
    '[cols="1,2"]',
    '|===',
    '|Signal |Expected result',
    `|Chapter ${index + 1} |The rendered heading and outline remain aligned.`,
    '|===',
    '',
    '[source,json]',
    '----',
    `{ "chapter": ${index + 1}, "status": "verified", "privateData": false }`,
    '----',
    '',
  ].join('\n'));
  return [
    '= Public Operations Manual',
    ':toc: left',
    ':sectnums:',
    '',
    'This is invented demonstration content. It contains no real company, customer, or repository information.',
    '',
    ...chapters,
  ].join('\n');
}

function createFixture(name) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `docpilot-${name}-demo-`));
  const fixture = path.join(sandbox, 'DocPilot-Demo');
  fs.mkdirSync(fixture);
  fs.mkdirSync(path.join(fixture, 'docs'));
  fs.writeFileSync(path.join(fixture, 'README.md'), [
    '# DocPilot Demo Project',
    '',
    'A public-safe document workbench fixture.',
    '',
    '## Release checklist',
    '',
    '- Review rendered changes',
    '- Run project commands in the terminal',
    '',
    '## Deployment confidence',
    '',
    'Verify the manual, downloadable build, and rollback note before publishing.',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(fixture, 'alpha.md'), '# Release plan\n\nKeep the primary document visible while arranging a second reference.\n', 'utf8');
  fs.writeFileSync(path.join(fixture, 'beta.md'), '# Implementation notes\n\nDrag this tab to an edge to create a second document pane.\n', 'utf8');
  fs.writeFileSync(path.join(fixture, 'manual.md'), longMarkdown(), 'utf8');
  fs.writeFileSync(path.join(fixture, 'manual.adoc'), longAsciiDoc(), 'utf8');
  fs.writeFileSync(path.join(fixture, 'sample.json'), JSON.stringify({ project: 'Public demo', verified: true, steps: ['open', 'inspect', 'confirm'] }, null, 2), 'utf8');
  fs.writeFileSync(path.join(fixture, 'docs', 'review.md'), '# Search evidence\n\nUnique project search evidence appears on this exact line.\n', 'utf8');
  fs.writeFileSync(path.join(fixture, 'AGENTS.md'), '# Demo instructions\n\n- Use public-safe fixture content.\n- Verify visible outcomes.\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'demo@docpilot.local'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'DocPilot Demo'], { cwd: fixture });
  execFileSync('git', ['add', '.'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'public demo fixture'], { cwd: fixture });
  return fixture;
}

async function waitForEditor(app) {
  const deadline = Date.now() + 20_000;
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
    if (window.__docpilotDemoCursorListener) {
      window.removeEventListener('pointermove', window.__docpilotDemoCursorListener, true);
    }
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
    window.__docpilotDemoCursorListener = event => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    };
    window.addEventListener('pointermove', window.__docpilotDemoCursorListener, true);
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
    await wait(durationMs / steps);
  }
}

async function typeHuman(page, text) {
  await page.keyboard.type(text, { delay: typingDelay });
}

async function initializeScenario(page, name) {
  await page.evaluate(({ terminalOpen }) => {
    localStorage.setItem('docpilot:theme-preference', 'dark');
    localStorage.setItem('docpilot:release-notice-seen-id', '2.0.3:r2');
    localStorage.setItem('docpilot:terminal-open', terminalOpen ? '1' : '0');
    localStorage.setItem('docpilot:preview-width', '760');
    localStorage.setItem('docpilot:preview-width-explicit-v1', '1');
    localStorage.setItem('docpilot:workbench-pane-layout', JSON.stringify({
      type: 'split', id: 'workbench-root', orientation: 'vertical', ratio: 0.68,
      children: [{ type: 'leaf', id: 'document', kind: 'document' }, { type: 'leaf', id: 'terminal', kind: 'terminal' }],
    }));
  }, { terminalOpen: name === 'tabs-and-panes-all-directions' });
  await page.reload();
  await page.waitForSelector('.workspace-file-row');
  await dismissReleaseNotice(page);

  if (name === 'workbench-overview' || name === 'asciidoc-long-cold-cache') return;
  if (name === 'tabs-and-panes-all-directions') {
    await openFile(page, 'alpha.md');
    await openFile(page, 'beta.md');
    await page.waitForSelector('.terminal-pane');
    const empty = page.locator('.terminal-empty');
    if (await empty.isVisible().catch(() => false)) await empty.click();
    await page.waitForSelector('.terminal-tab.active');
  } else if (name === 'preview-navigation-width') {
    await openFile(page, 'manual.md');
  } else {
    await openFile(page, 'README.md');
  }
  await wait(600);
}

async function openQuickResult(page, query, expectedFile, cursor, target, marks, startedAt) {
  await page.mouse.click(target.x, target.y);
  await page.waitForSelector('.quick-open-overlay');
  await wait(650);
  const input = page.locator('.quick-open-panel input');
  await input.focus();
  await typeHuman(page, query);
  await wait(650);
  const result = page.locator('.quick-open-row').filter({ hasText: expectedFile }).first();
  const resultPoint = await boxPoint(result, 'Quick open result');
  await movePointer(page, target, resultPoint, 700);
  await wait(550);
  await page.mouse.click(resultPoint.x, resultPoint.y);
  await page.waitForFunction(file => document.querySelector('.file-tab.active')?.textContent?.includes(file), expectedFile);
  marks.actionEnd = Date.now() - startedAt;
  return resultPoint;
}

async function runWorkbench(page, startedAt, marks) {
  const name = 'workbench-overview';
  const neutral = { x: 930, y: 520 };
  const target = await boxPoint(page.getByRole('button', { name: 'Quick open', exact: true }), 'Quick open');
  await installDemoCursor(page, neutral);
  await wait(phaseMs(name, 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, target, phaseMs(name, 'focus'));
  await wait(600);
  marks.focusEnd = Date.now() - startedAt;
  await openQuickResult(page, 'README', 'README.md', neutral, target, marks, startedAt);
  await page.waitForSelector('.markdown-preview h1');
  await wait(phaseMs(name, 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: marks.focusEnd + 700 };
}

async function runQuickOpen(page, startedAt, marks) {
  const name = 'quick-open-human-typing';
  const neutral = { x: 910, y: 510 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs(name, 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await page.keyboard.press('Meta+p');
  await page.waitForSelector('.quick-open-overlay');
  const input = page.locator('.quick-open-panel input');
  const target = await boxPoint(input, 'Quick open input');
  await movePointer(page, neutral, target, phaseMs(name, 'focus'));
  await wait(600);
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.click(target.x, target.y);
  await typeHuman(page, 'beta.md');
  await wait(650);
  const result = page.locator('.quick-open-row').filter({ hasText: 'beta.md' }).first();
  const resultPoint = await boxPoint(result, 'Quick open beta.md result');
  await movePointer(page, target, resultPoint, 700);
  await wait(550);
  await page.mouse.click(resultPoint.x, resultPoint.y);
  await page.waitForFunction(() => document.querySelector('.file-tab.active')?.textContent?.includes('beta.md'));
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs(name, 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: marks.focusEnd + 700 };
}

async function beginPaneDrag(page, selector, cursor) {
  const source = await boxPoint(page.locator(selector), selector);
  const stackBox = await page.locator('.workbench-stack').boundingBox();
  if (!stackBox) throw new Error('Workbench stack geometry is unavailable.');
  await movePointer(page, cursor, source, 850);
  await wait(550);
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  const activation = { x: source.x + 12, y: source.y + 4 };
  await page.mouse.move(activation.x, activation.y, { steps: 4 });
  await page.waitForSelector('.pane-drop-overlay');
  return { source, activation, stackBox };
}

async function dragTerminalTo(page, cursor, edge) {
  const { activation, stackBox } = await beginPaneDrag(page, '.terminal-tabbar-drag-surface', cursor);
  const ratios = { left: [0.34, 0.5], right: [0.66, 0.5], top: [0.5, 0.34], bottom: [0.5, 0.66] };
  const [xRatio, yRatio] = ratios[edge];
  const drop = { x: stackBox.x + stackBox.width * xRatio, y: stackBox.y + stackBox.height * yRatio };
  await movePointer(page, activation, drop, 1300);
  await page.waitForFunction(position => document.querySelector('.workbench-stack')?.classList.contains(`terminal-${position}`), edge);
  await wait(700);
  await page.mouse.up();
  await page.waitForFunction(position => document.querySelector('.workbench-stack')?.classList.contains(`terminal-${position}`), edge);
  await wait(900);
  return drop;
}

async function clickTerminalDock(page, cursor, edge) {
  const labels = { left: 'Dock terminal left', right: 'Dock terminal right', top: 'Dock terminal above', bottom: 'Dock terminal below' };
  const button = page.getByLabel(labels[edge]);
  const point = await boxPoint(button, labels[edge]);
  await movePointer(page, cursor, point, 900);
  await wait(600);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(position => document.querySelector('.workbench-stack')?.classList.contains(`terminal-${position}`), edge);
  await wait(1000);
  return point;
}

async function runTabsAndPanes(page, startedAt, marks) {
  const name = 'tabs-and-panes-all-directions';
  const tab = page.locator('.file-tab').filter({ hasText: 'beta.md' }).first();
  const source = await boxPoint(tab, 'beta.md tab');
  const paneBox = await page.locator('.workbench-document-pane').boundingBox();
  if (!paneBox) throw new Error('Document pane geometry is unavailable.');
  const neutral = { x: paneBox.x + paneBox.width * 0.52, y: paneBox.y + paneBox.height * 0.58 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs(name, 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, source, phaseMs(name, 'focus'));
  await wait(600);
  marks.focusEnd = Date.now() - startedAt;
  let cursor = source;
  for (const edge of ['right', 'top', 'left', 'bottom']) cursor = await clickTerminalDock(page, cursor, edge);

  const refreshedTab = page.locator('.file-tab').filter({ hasText: 'beta.md' }).first();
  const refreshedSource = await boxPoint(refreshedTab, 'beta.md tab after Pane movement');
  const refreshedPaneBox = await page.locator('.workbench-document-pane').boundingBox();
  if (!refreshedPaneBox) throw new Error('Document pane geometry is unavailable after Pane movement.');
  await movePointer(page, cursor, refreshedSource, 900);
  await wait(600);
  await page.mouse.down();
  const activation = { x: refreshedSource.x + 18, y: refreshedSource.y + 8 };
  await movePointer(page, refreshedSource, activation, 280);
  const documentEdges = [
    ['left', 0.12, 0.5], ['top', 0.5, 0.12], ['bottom', 0.5, 0.88], ['right', 0.88, 0.5],
  ];
  cursor = activation;
  for (const [edge, xRatio, yRatio] of documentEdges) {
    const point = { x: refreshedPaneBox.x + refreshedPaneBox.width * xRatio, y: refreshedPaneBox.y + refreshedPaneBox.height * yRatio };
    await movePointer(page, cursor, point, 1100);
    await page.waitForSelector(`.document-tab-drop-preview.edge-${edge}`);
    await wait(750);
    cursor = point;
  }
  await page.mouse.up();
  await page.waitForSelector('.preview-compare-horizontal');
  await wait(1100);
  marks.actionEnd = Date.now() - startedAt;
  marks.previewEnd = marks.actionEnd;
  await wait(phaseMs(name, 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: source, overviewStartMs: marks.focusEnd + 650 };
}

async function runSearch(page, startedAt, marks) {
  const name = 'project-search-complete';
  const neutral = { x: 920, y: 500 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs(name, 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await page.keyboard.press('Meta+Shift+f');
  await page.waitForSelector('.project-search-panel');
  const input = page.locator('.project-search-input');
  const target = await boxPoint(input, 'Project search');
  await movePointer(page, neutral, target, phaseMs(name, 'focus'));
  await wait(600);
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.click(target.x, target.y);
  await typeHuman(page, 'Unique project search evidence');
  await page.waitForSelector('.project-search-result');
  await wait(800);
  const result = page.locator('.project-search-result').first();
  const resultPoint = await boxPoint(result, 'Project search result');
  await movePointer(page, target, resultPoint, 850);
  await wait(550);
  await page.mouse.click(resultPoint.x, resultPoint.y);
  await page.waitForFunction(() => document.querySelector('.file-tab.active')?.textContent?.includes('review.md'));
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs(name, 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: marks.focusEnd + 700 };
}

async function runAsciiDoc(page, startedAt, marks) {
  const name = 'asciidoc-long-cold-cache';
  const row = page.locator('.workspace-file-row').filter({ hasText: 'manual.adoc' }).first();
  const target = await boxPoint(row, 'manual.adoc');
  const neutral = { x: 900, y: 500 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs(name, 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, target, phaseMs(name, 'focus'));
  await wait(600);
  marks.focusEnd = Date.now() - startedAt;
  const coldStartedAt = Date.now();
  await page.mouse.click(target.x, target.y);
  await page.waitForSelector('.editor-mode-toggle');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.markdown-preview')?.textContent?.includes('Workflow Chapter 01'), null, { timeout: 20_000 });
  marks.coldLoadMs = Date.now() - coldStartedAt;
  await wait(1800);
  await openFile(page, 'README.md');
  await wait(800);
  const cachedStartedAt = Date.now();
  await openFile(page, 'manual.adoc');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.markdown-preview')?.textContent?.includes('Workflow Chapter 01'), null, { timeout: 10_000 });
  marks.cachedLoadMs = Date.now() - cachedStartedAt;
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs(name, 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: marks.focusEnd + 700 };
}

async function runPreviewNavigation(page, startedAt, marks) {
  const name = 'preview-navigation-width';
  const toc = page.locator('.toc-item').filter({ hasText: 'Workflow 18' }).first();
  const target = await boxPoint(toc, 'Preview outline entry');
  const neutral = { x: 820, y: 480 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs(name, 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, target, phaseMs(name, 'focus'));
  await wait(550);
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.click(target.x, target.y);
  await wait(900);
  await page.keyboard.press('Meta+f');
  await page.waitForSelector('.preview-find-bar');
  const input = page.locator('.preview-find-bar input');
  await input.focus();
  await typeHuman(page, 'Verification signal');
  await wait(900);
  await page.keyboard.press('Escape');
  const handle = page.locator('.preview-width-resizer');
  const handlePoint = await boxPoint(handle, 'Preview width handle');
  await movePointer(page, target, handlePoint, 900);
  await wait(500);
  await page.mouse.down();
  const resized = { x: handlePoint.x + 120, y: handlePoint.y };
  await movePointer(page, handlePoint, resized, 1400);
  await page.mouse.up();
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs(name, 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: marks.focusEnd + 700 };
}

async function runDiff(page, startedAt, marks) {
  const name = 'diff-edit-to-changes';
  const sourceButton = page.getByRole('button', { name: 'Source', exact: true });
  const target = await boxPoint(sourceButton, 'Source mode');
  const neutral = { x: 850, y: 500 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs(name, 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, target, phaseMs(name, 'focus'));
  await wait(600);
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.click(target.x, target.y);
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Meta+End');
  await typeHuman(page, '\n\n## Verified handoff\n\nThe reviewed manual is ready for a careful final check.');
  await wait(800);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.waitForSelector('.markdown-preview h1');
  const diffToggle = page.locator('.diff-toggle').filter({ hasText: 'Diff' }).first();
  const diffPoint = await boxPoint(diffToggle, 'Diff toggle');
  await movePointer(page, target, diffPoint, 850);
  await wait(600);
  await page.mouse.click(diffPoint.x, diffPoint.y);
  await page.waitForSelector('.diff-changes-rail');
  await wait(1000);
  const changes = page.locator('.diff-change-list > button');
  const count = await changes.count();
  let cursor = diffPoint;
  for (let index = 0; index < Math.min(3, count); index += 1) {
    const point = await boxPoint(changes.nth(index), `Diff change ${index + 1}`);
    await movePointer(page, cursor, point, 750);
    await wait(450);
    await page.mouse.click(point.x, point.y);
    await wait(800);
    cursor = point;
  }
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs(name, 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: diffPoint, overviewStartMs: marks.focusEnd + 700 };
}

async function openTerminal(page, cursor) {
  const reopen = page.locator('.terminal-reopen-button');
  const point = await boxPoint(reopen, 'Open terminal');
  await movePointer(page, cursor, point, 950);
  await wait(650);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('.terminal-pane');
  const empty = page.locator('.terminal-empty');
  let next = point;
  if (await empty.isVisible().catch(() => false)) {
    const emptyPoint = await boxPoint(empty, 'New terminal');
    await movePointer(page, point, emptyPoint, 800);
    await wait(550);
    await page.mouse.click(emptyPoint.x, emptyPoint.y);
    next = emptyPoint;
  }
  await page.waitForSelector('.terminal-tab.active');
  const screen = page.locator('.terminal-xterm-host .xterm-screen');
  const screenPoint = await boxPoint(screen, 'Terminal screen');
  await movePointer(page, next, screenPoint, 800);
  await wait(500);
  await page.mouse.click(screenPoint.x, screenPoint.y);
  return { entryPoint: point, screenPoint };
}

async function runTerminal(page, startedAt, marks) {
  const name = 'terminal-open-session';
  const neutral = { x: 850, y: 430 };
  const target = await boxPoint(page.locator('.terminal-reopen-button'), 'Open terminal');
  await installDemoCursor(page, neutral);
  await wait(phaseMs(name, 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, target, phaseMs(name, 'focus'));
  await wait(650);
  marks.focusEnd = Date.now() - startedAt;
  const terminal = await openTerminal(page, target);
  await typeHuman(page, "printf 'DocPilot terminal ready\\n'");
  await page.keyboard.press('Enter');
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs(name, 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: marks.focusEnd + 700, terminalScreen: terminal.screenPoint };
}

async function runContextToClaude(page, startedAt, marks, app) {
  const name = 'preview-context-to-claude';
  const paragraph = page.locator('.markdown-preview p').filter({ hasText: 'Verify the manual' }).first();
  const target = await boxPoint(paragraph, 'Preview context block');
  const neutral = { x: 820, y: 480 };
  await installDemoCursor(page, neutral);
  await wait(phaseMs(name, 'input'));
  marks.inputEnd = Date.now() - startedAt;
  await movePointer(page, neutral, target, phaseMs(name, 'focus'));
  await wait(650);
  marks.focusEnd = Date.now() - startedAt;
  await page.mouse.click(target.x, target.y);
  await page.waitForSelector('.document-context-chip');
  const copiedContext = await app.evaluate(({ clipboard }) => clipboard.readText());
  if (!copiedContext.includes('README.md') || !copiedContext.includes('Verify the manual')) {
    throw new Error(`DocPilot context clipboard is incomplete: ${copiedContext}`);
  }
  marks.copiedContext = {
    file: copiedContext.includes('README.md'),
    line: /line|줄|:\d+/i.test(copiedContext),
    body: copiedContext.includes('Verify the manual'),
    characters: copiedContext.length,
  };
  await wait(1000);
  const terminal = await openTerminal(page, target);
  let cursor = await clickTerminalDock(page, terminal.screenPoint, 'right');
  const resizer = page.locator('.terminal-split-resizer');
  const resizerPoint = await boxPoint(resizer, 'Terminal split resizer');
  await movePointer(page, cursor, resizerPoint, 800);
  await wait(500);
  await page.mouse.down();
  const widerTerminal = { x: resizerPoint.x - 120, y: resizerPoint.y };
  await movePointer(page, resizerPoint, widerTerminal, 1200);
  await page.mouse.up();
  await wait(700);
  const screen = page.locator('.terminal-xterm-host .xterm-screen');
  const screenPoint = await boxPoint(screen, 'Claude terminal screen');
  await movePointer(page, widerTerminal, screenPoint, 700);
  await page.mouse.click(screenPoint.x, screenPoint.y);
  await typeHuman(page, 'claude');
  await page.keyboard.press('Enter');
  await wait(4500);
  const terminalText = await page.locator('.terminal-xterm-host').innerText().catch(() => '');
  if (/trust|신뢰/i.test(terminalText)) {
    await page.keyboard.press('Enter');
    await wait(2500);
  }
  await page.keyboard.press('Meta+v');
  await wait(2800);
  await page.keyboard.press('Enter');
  marks.actionEnd = Date.now() - startedAt;
  await wait(phaseMs(name, 'result'));
  marks.resultEnd = Date.now() - startedAt;
  return { focusPoint: target, overviewStartMs: marks.focusEnd + 700, terminalScreen: screenPoint };
}

const scenarioRunners = {
  'workbench-overview': runWorkbench,
  'tabs-and-panes-all-directions': runTabsAndPanes,
  'quick-open-human-typing': runQuickOpen,
  'project-search-complete': runSearch,
  'asciidoc-long-cold-cache': runAsciiDoc,
  'preview-navigation-width': runPreviewNavigation,
  'diff-edit-to-changes': runDiff,
  'preview-context-to-claude': runContextToClaude,
  'terminal-open-session': runTerminal,
};

async function captureScenario(name) {
  const fixture = createFixture(name);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `docpilot-${name}-demo-user-`));
  const recordDir = path.join(rawRoot, `${name}-recording`);
  fs.mkdirSync(recordDir, { recursive: true });
  const app = await electron.launch({
    args: ['.', fixture], cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_USER_DATA_DIR: userData,
      // Keep the terminal real while preventing personal login scripts from
      // obscuring the product flow with unrelated SSH/keychain prompts.
      ZDOTDIR: userData,
    },
    recordVideo: { dir: recordDir, size: spec.capture.viewport },
  });
  let video;
  let metadata;

  try {
    const page = await waitForEditor(app);
    const pageDetectedAt = Date.now();
    page.setDefaultTimeout(20_000);
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
    const camera = await scenarioRunners[name](page, scenarioStartedAt, phaseMarks, app);
    const scenarioEndedAt = Date.now();
    const postScenarioHoldMs = 600;
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
      privacy: { fixture: 'synthetic-public-safe', privateContent: false },
    };
  } finally {
    await app.close().catch(() => {});
  }

  try {
    const rawPath = path.join(rawRoot, `${name}.webm`);
    const metadataPath = path.join(rawRoot, `${name}.json`);
    await video.saveAs(rawPath);
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(JSON.stringify({ name, rawPath, metadataPath, durationMs: metadata.measuredScenarioDurationMs, phaseMarks: metadata.phaseMarks }));
  } finally {
    try { execFileSync('pkill', ['-f', `bridge.js --root ${fixture}`]); } catch {}
    fs.rmSync(path.dirname(fixture), { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(recordDir, { recursive: true, force: true });
  }
}

async function main() {
  fs.mkdirSync(rawRoot, { recursive: true });
  const names = requestedScenario === 'all' ? Object.keys(scenarioRunners) : requestedScenario.split(',').map(name => name.trim()).filter(Boolean);
  for (const name of names) {
    if (!scenarioRunners[name]) throw new Error(`Unknown demo scenario: ${name}`);
    await captureScenario(name);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  createFixture,
  dismissReleaseNotice,
  openFile,
  waitForEditor,
};
