'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  downloadVerifiedAsset,
  uniqueDownloadPath,
} = require('../shared/core/update-download');

function responseFor(body, overrides = {}) {
  return new Response(body, {
    status: overrides.status || 200,
    headers: { 'content-length': String(Buffer.byteLength(body)), ...overrides.headers },
  });
}

test('downloads to a partial file, verifies size and SHA-256, and reports progress', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-update-download-'));
  const body = Buffer.from('verified dmg fixture');
  const digest = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;
  const destination = path.join(dir, 'DocPilot-2.0.3-arm64.dmg');
  const progress = [];

  try {
    const result = await downloadVerifiedAsset({
      asset: {
        url: 'https://github.com/dotoricode/docpilot/releases/download/v2.0.3/DocPilot-2.0.3-arm64.dmg',
        size: body.length,
        digest,
      },
      destination,
      fetchImpl: async () => responseFor(body),
      onProgress: value => progress.push(value),
    });

    assert.equal(result.path, destination);
    assert.equal(result.digest, digest);
    assert.deepEqual(fs.readFileSync(destination), body);
    assert.equal(fs.existsSync(`${destination}.part`), false);
    assert.equal(progress.at(-1).received, body.length);
    assert.equal(progress.at(-1).percent, 100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('digest mismatch removes the partial file and never replaces the destination', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-update-download-'));
  const body = Buffer.from('tampered fixture');
  const destination = path.join(dir, 'DocPilot-2.0.3-arm64.dmg');

  try {
    await assert.rejects(downloadVerifiedAsset({
      asset: {
        url: 'https://github.com/dotoricode/docpilot/releases/download/v2.0.3/DocPilot-2.0.3-arm64.dmg',
        size: body.length,
        digest: `sha256:${'0'.repeat(64)}`,
      },
      destination,
      fetchImpl: async () => responseFor(body),
    }), /SHA-256/);
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.existsSync(`${destination}.part`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an untrusted final download host and leaves no file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-update-download-'));
  const destination = path.join(dir, 'DocPilot-2.0.3-arm64.dmg');
  const body = Buffer.from('fixture');

  try {
    await assert.rejects(downloadVerifiedAsset({
      asset: {
        url: 'https://github.com/dotoricode/docpilot/releases/download/v2.0.3/DocPilot-2.0.3-arm64.dmg',
        size: body.length,
        digest: `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`,
      },
      destination,
      fetchImpl: async () => {
        const response = responseFor(body);
        Object.defineProperty(response, 'url', { value: 'https://evil.example/DocPilot.dmg' });
        return response;
      },
    }), /신뢰할 수 없는/);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('chooses a non-destructive download filename when an artifact already exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-update-name-'));
  try {
    fs.writeFileSync(path.join(dir, 'DocPilot-2.0.3-arm64.dmg'), 'old');
    fs.writeFileSync(path.join(dir, 'DocPilot-2.0.3-arm64 (1).dmg'), 'old');
    assert.equal(
      uniqueDownloadPath(dir, 'DocPilot-2.0.3-arm64.dmg'),
      path.join(dir, 'DocPilot-2.0.3-arm64 (2).dmg'),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
