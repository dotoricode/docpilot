const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'prototypes/manual-v2/content/demo-motion-spec.json'), 'utf8'));
const scenario = spec.scenarios.paneLayout;
const artifactRoot = path.join(root, '.tink/current/artifacts/demo-pilot');
const rawPath = path.join(artifactRoot, 'pane-layout-raw.webm');
const metadataPath = path.join(artifactRoot, 'pane-layout-raw.json');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function createFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-pane-pilot-'));
  fs.writeFileSync(path.join(fixture, 'alpha.md'), [
    '# Release plan',
    '',
    'Keep the primary document visible while arranging a second reference.',
    '',
    '## Checklist',
    '',
    '- Review the document hierarchy',
    '- Compare the implementation notes',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(fixture, 'beta.md'), [
    '# Implementation notes',
    '',
    'Drag this tab to the right edge to create a second document pane.',
    '',
    '## Result',
    '',
    'Both documents remain visible with independent tab strips.',
  ].join('\n'), 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'demo@docpilot.local'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'DocPilot Demo'], { cwd: fixture });
  execFileSync('git', ['add', '.'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'pane demo fixture'], { cwd: fixture });
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
  if (!await notice.waitFor({ state: 'visible', timeout: 2_500 }).then(() => true).catch(() => false)) return;
  const confirm = notice.getByRole('button', { name: '확인' });
  if (await confirm.count()) await confirm.click();
  else await notice.click({ position: { x: 8, y: 8 } });
  await notice.waitFor({ state: 'hidden' });
}

async function installDemoCursor(page, point) {
  await page.evaluate(({ x, y }) => {
    document.querySelector('[data-docpilot-demo-cursor]')?.remove();
    const cursor = document.createElement('div');
    cursor.dataset.docpilotDemoCursor = 'true';
    Object.assign(cursor.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      width: '20px',
      height: '26px',
      zIndex: '2147483647',
      pointerEvents: 'none',
      transform: 'translate(-2px, -2px)',
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
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    const point = {
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    };
    await page.mouse.move(point.x, point.y);
    await page.evaluate(({ x, y }) => {
      const cursor = document.querySelector('[data-docpilot-demo-cursor]');
      if (cursor) {
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
      }
    }, point);
    await wait(durationMs / steps);
  }
}

async function openFile(page, name) {
  await page.locator('.workspace-file-row').filter({ hasText: name }).first().click();
  await page.waitForSelector('.editor-mode-toggle');
}

async function capture() {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const fixture = createFixture();
  const recordDir = path.join(artifactRoot, 'recording');
  fs.mkdirSync(recordDir, { recursive: true });
  const app = await electron.launch({
    args: ['.', fixture],
    cwd: root,
    env: { ...process.env, DOCPILOT_FAKE_AGENT: '1' },
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
      window.setContentSize(1440, 900);
      window.center();
      window.show();
    });
    await page.setViewportSize(spec.capture.viewport);
    await dismissReleaseNotice(page);
    await page.evaluate(() => {
      localStorage.setItem('docpilot:terminal-open', '0');
      localStorage.setItem('docpilot:theme-preference', 'dark');
      localStorage.setItem('docpilot:workbench-pane-layout', JSON.stringify({
        type: 'split', id: 'workbench-root', orientation: 'vertical', ratio: 0.7,
        children: [{ type: 'leaf', id: 'document', kind: 'document' }, { type: 'leaf', id: 'terminal', kind: 'terminal' }],
      }));
    });
    await page.reload();
    await page.waitForSelector('.workspace-file-row');
    await dismissReleaseNotice(page);
    const closeTerminal = page.getByLabel('Close terminal pane').first();
    if (await closeTerminal.count()) {
      await closeTerminal.click();
      await page.waitForSelector('.terminal-reopen-button');
    }
    await openFile(page, 'alpha.md');
    await openFile(page, 'beta.md');
    const preview = page.locator('.editor-mode-toggle button').filter({ hasText: 'Preview' });
    if (await preview.count()) await preview.click();
    await page.waitForSelector('.markdown-preview');
    await wait(700);

    video = page.video();
    if (!video) throw new Error('Playwright video recording did not attach.');
    const source = page.locator('.file-tab').filter({ hasText: 'beta.md' }).first();
    const sourceBox = await source.boundingBox();
    const paneBox = await page.locator('.workbench-document-pane').boundingBox();
    if (!sourceBox || !paneBox) throw new Error('Pane pilot geometry is unavailable.');
    const sourcePoint = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    const neutralPoint = { x: paneBox.x + paneBox.width * 0.55, y: paneBox.y + paneBox.height * 0.62 };
    const activationPoint = { x: sourcePoint.x + 15, y: sourcePoint.y + 8 };
    const dropPoint = { x: paneBox.x + paneBox.width * 0.88, y: paneBox.y + paneBox.height * 0.5 };
    await installDemoCursor(page, neutralPoint);
    await wait(300);

    const scenarioStartedAt = Date.now();
    const phaseMarks = { start: 0 };
    await wait(scenario.phases[0].durationMs);
    phaseMarks.inputEnd = Date.now() - scenarioStartedAt;
    await movePointer(page, neutralPoint, sourcePoint, scenario.phases[1].durationMs);
    phaseMarks.focusEnd = Date.now() - scenarioStartedAt;
    await page.mouse.down();
    await movePointer(page, sourcePoint, activationPoint, 150);
    await movePointer(page, activationPoint, dropPoint, scenario.phases[2].durationMs - 150);
    await page.waitForSelector('.document-tab-drop-preview.edge-right');
    phaseMarks.actionEnd = Date.now() - scenarioStartedAt;
    await wait(scenario.phases[3].durationMs);
    phaseMarks.previewEnd = Date.now() - scenarioStartedAt;
    await page.mouse.up();
    await page.waitForSelector('.preview-compare-horizontal');
    await wait(scenario.phases[4].durationMs);
    phaseMarks.dropEnd = Date.now() - scenarioStartedAt;
    await wait(scenario.phases[5].durationMs);
    phaseMarks.resultEnd = Date.now() - scenarioStartedAt;
    const scenarioEndedAt = Date.now();
    const postScenarioHoldMs = 500;
    await wait(postScenarioHoldMs);

    metadata = {
      scenario: scenario.id,
      pageDetectedAt,
      scenarioStartedAfterPageDetectedMs: scenarioStartedAt - pageDetectedAt,
      measuredScenarioDurationMs: scenarioEndedAt - scenarioStartedAt,
      expectedScenarioDurationMs: scenario.totalDurationMs,
      postScenarioHoldMs,
      phaseMarks,
      geometry: { sourceBox, paneBox, sourcePoint, neutralPoint, activationPoint, dropPoint },
    };
  } finally {
    await app.close().catch(() => {});
  }

  try {
    await video.saveAs(rawPath);
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(JSON.stringify({ rawPath, metadataPath, metadata }));
  } finally {
    try { execFileSync('pkill', ['-f', `bridge.js --root ${fixture}`]); } catch {}
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(recordDir, { recursive: true, force: true });
  }
}

capture().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
