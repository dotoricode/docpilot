'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUpdateController } = require('../shared/core/update-controller');

function releaseFixture(body) {
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  return {
    tag_name: 'v2.0.3',
    html_url: 'https://github.com/dotoricode/docpilot/releases/tag/v2.0.3',
    draft: false,
    prerelease: false,
    assets: [{
      name: 'DocPilot-2.0.3-arm64.dmg',
      size: body.length,
      browser_download_url: 'https://github.com/dotoricode/docpilot/releases/download/v2.0.3/DocPilot-2.0.3-arm64.dmg',
      digest: `sha256:${digest}`,
    }],
  };
}

test('check, download, and open use main-owned release state without a quit lifecycle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-update-controller-'));
  const body = Buffer.alloc(50 * 1024 * 1024, 7);
  const states = [];
  const opened = [];
  const sessionState = { terminal: 'running', agent: 'streaming', dirtyDocument: true };

  try {
    const controller = createUpdateController({
      repository: 'dotoricode/docpilot',
      currentVersion: '2.0.2',
      arch: 'arm64',
      downloadsDirectory: () => dir,
      fetchRelease: async () => releaseFixture(body),
      fetchAsset: async () => new Response(body, {
        headers: { 'content-length': String(body.length) },
      }),
      openPath: async filePath => { opened.push(filePath); return ''; },
      onState: state => states.push(state),
    });

    assert.equal((await controller.check()).status, 'available');
    assert.equal(states[0].status, 'checking');
    assert.equal(controller.getState().version, '2.0.3');
    const downloaded = await controller.download();
    assert.equal(downloaded.status, 'downloaded');
    assert.equal(downloaded.fileName, 'DocPilot-2.0.3-arm64.dmg');
    assert.deepEqual(sessionState, { terminal: 'running', agent: 'streaming', dirtyDocument: true });
    assert.equal(states.some(state => state.status === 'downloading'), true);
    assert.equal(states.at(-1).status, 'downloaded');

    assert.equal(await controller.openDownloaded(), true);
    assert.deepEqual(opened, [path.join(dir, 'DocPilot-2.0.3-arm64.dmg')]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('download is unavailable before a trusted newer release has been checked', async () => {
  const controller = createUpdateController({
    repository: 'dotoricode/docpilot',
    currentVersion: '2.0.2',
    arch: 'arm64',
    downloadsDirectory: () => os.tmpdir(),
    fetchRelease: async () => ({}),
    fetchAsset: async () => { throw new Error('must not run'); },
    openPath: async () => '',
  });

  await assert.rejects(controller.download(), /사용 가능한 업데이트/);
  await assert.rejects(controller.openDownloaded(), /다운로드된 업데이트/);
});

test('check publishes latest when the installed version matches the release', async () => {
  const states = [];
  const controller = createUpdateController({
    repository: 'dotoricode/docpilot',
    currentVersion: '2.0.3',
    arch: 'arm64',
    downloadsDirectory: () => os.tmpdir(),
    fetchRelease: async () => releaseFixture(Buffer.alloc(50 * 1024 * 1024, 7)),
    fetchAsset: async () => { throw new Error('must not run'); },
    openPath: async () => '',
    onState: state => states.push(state),
  });

  assert.equal((await controller.check()).status, 'latest');
  assert.deepEqual(states.map(state => state.status), ['checking', 'latest']);
});

test('check publishes a visible error state and preserves the failure', async () => {
  const states = [];
  const controller = createUpdateController({
    repository: 'dotoricode/docpilot',
    currentVersion: '2.0.3',
    arch: 'arm64',
    downloadsDirectory: () => os.tmpdir(),
    fetchRelease: async () => { throw new Error('network unavailable'); },
    fetchAsset: async () => { throw new Error('must not run'); },
    openPath: async () => '',
    onState: state => states.push(state),
  });

  await assert.rejects(controller.check(), /network unavailable/);
  assert.deepEqual(states.map(state => state.status), ['checking', 'error']);
  assert.match(controller.getState().error, /network unavailable/);
});
