import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manual = path.join(root, 'prototypes/manual-v2');
const port = 41739;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: manual,
  env: { ...process.env, BROWSER: 'none' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`manual dev server exited early\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/docs`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`manual dev server did not start\n${serverOutput}`);
}

const browser = await chromium.launch({ headless: true });
try {
  await waitForServer();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('https://api.github.com/repos/dotoricode/docpilot/releases', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      tag_name: 'v2.0.2',
      name: 'DocPilot 2.0.2',
      body: 'Release download fixture',
      published_at: '2026-07-18T00:00:00Z',
      assets: [
        { name: 'DocPilot-2.0.2-x64.dmg', browser_download_url: 'https://downloads.example/DocPilot-2.0.2-x64.dmg' },
        { name: 'DocPilot-2.0.2-arm64.dmg', browser_download_url: 'https://downloads.example/DocPilot-2.0.2-arm64.dmg' },
      ],
    }]),
  }));
  await page.route('https://downloads.example/*.dmg', route => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    window.__demoObservers = [];
    window.IntersectionObserver = class MockIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        this.target = null;
        this.disconnected = false;
        window.__demoObservers.push(this);
      }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
      unobserve() {}
    };
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() { return this.__paused ?? true; },
    });
    HTMLMediaElement.prototype.play = function play() {
      this.__paused = false;
      this.__playCount = (this.__playCount || 0) + 1;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      this.__paused = true;
      this.__pauseCount = (this.__pauseCount || 0) + 1;
      this.dispatchEvent(new Event('pause'));
    };
  });

  await page.goto(`${baseUrl}/docs`, { timeout: 90_000 });
  const firstVideo = page.locator('video[data-media-asset="workbench-overview"]');
  await firstVideo.waitFor();
  const firstHandle = await firstVideo.elementHandle();
  assert.ok(firstHandle, 'overview video element must exist');

  await page.evaluate(() => {
    const observer = window.__demoObservers.at(-1);
    observer.callback([{ target: observer.target, isIntersecting: true, intersectionRatio: 0.6 }]);
  });
  assert.equal(await firstVideo.evaluate(video => video.__playCount), 1, 'visible demo must autoplay');

  const pausesBeforeExit = await firstVideo.evaluate(video => video.__pauseCount || 0);
  await page.evaluate(() => {
    const observer = window.__demoObservers.at(-1);
    observer.callback([{ target: observer.target, isIntersecting: false, intersectionRatio: 0 }]);
  });
  assert.equal(await firstVideo.evaluate(video => video.__pauseCount), pausesBeforeExit + 1, 'offscreen demo must pause');

  await page.evaluate(() => {
    const observer = window.__demoObservers.at(-1);
    observer.callback([{ target: observer.target, isIntersecting: true, intersectionRatio: 0.6 }]);
  });
  assert.equal(await firstVideo.evaluate(video => video.__playCount), 2, 'visible demo must resume after re-entry');

  await firstVideo.evaluate(video => video.dispatchEvent(new Event('ended')));
  await page.waitForTimeout(2700);
  assert.equal(await firstVideo.evaluate(video => video.__playCount), 2, 'result must remain still before the three-second hold ends');
  await page.waitForTimeout(450);
  assert.equal(await firstVideo.evaluate(video => video.__playCount), 3, 'visible demo must replay after the three-second result hold');

  await page.evaluate(() => {
    history.pushState({}, '', '/docs/review/diff');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const diffVideo = page.locator('video[data-media-asset="diff-edit-to-changes"]');
  await diffVideo.waitFor();
  const diffHandle = await diffVideo.elementHandle();
  assert.ok(diffHandle, 'Diff video element must exist');
  assert.equal(await firstHandle.evaluate((oldVideo, newVideo) => oldVideo.isSameNode(newVideo), diffHandle), false, 'route navigation must replace the video element');
  assert.match(await diffVideo.locator('source[type="video/webm"]').getAttribute('src'), /diff-edit-to-changes\.webm$/, 'route navigation must replace the video source');
  assert.equal(await page.evaluate(() => window.__demoObservers
    .filter(observer => observer.target?.dataset.mediaAsset === 'workbench-overview')
    .every(observer => observer.disconnected)), true, 'route navigation must disconnect the previous observer');

  await page.evaluate(() => {
    history.pushState({}, '', '/docs');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const returnedOverview = page.locator('video[data-media-asset="workbench-overview"]');
  await returnedOverview.waitFor();
  assert.equal(await page.locator('.guide-media video').count(), 1, 'DocPilot overview must render only its own demo');
  assert.match(await returnedOverview.locator('source[type="video/webm"]').getAttribute('src'), /workbench-overview\.webm$/, 'returning to DocPilot overview must restore its own source');
  assert.equal(await page.evaluate(() => window.__demoObservers
    .filter(observer => observer.target?.dataset.mediaAsset === 'diff-edit-to-changes')
    .every(observer => observer.disconnected)), true, 'returning to overview must disconnect the Diff observer');

  await page.evaluate(() => {
    history.pushState({}, '', '/changelog');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const changelogVideo = page.locator('video[data-media-asset="workbench-overview"]');
  await changelogVideo.waitFor();
  assert.equal(await page.locator('video[data-media-asset="workbench"]').count(), 0, 'Changelog must not revive a legacy fast demo');
  assert.match(await changelogVideo.locator('source[type="video/webm"]').getAttribute('src'), /workbench-overview\.webm$/, 'Changelog must use the current overview demo');

  await page.locator('.download-action').click();
  await page.getByRole('dialog', { name: 'macOS 다운로드 선택' }).waitFor();
  assert.equal(await page.locator('.download-options > button').count(), 2, 'Download must expose both macOS architectures');
  const arm64Request = page.waitForRequest('https://downloads.example/DocPilot-2.0.2-arm64.dmg');
  await page.locator('.download-options > button').filter({ hasText: 'Apple Silicon' }).click();
  await arm64Request;

  await page.locator('.download-action').click();
  const x64Request = page.waitForRequest('https://downloads.example/DocPilot-2.0.2-x64.dmg');
  await page.locator('.download-options > button').filter({ hasText: 'Intel Mac' }).click();
  await x64Request;

  console.log('manual v2 demo playback and architecture download regression: passed');
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
