'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareVersions,
  selectUpdateRelease,
} = require('../shared/core/update-release');

function releaseFixture(overrides = {}) {
  const version = overrides.version || '2.0.3';
  const arch = overrides.arch || 'arm64';
  const name = `DocPilot-${version}-${arch}.dmg`;
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/dotoricode/docpilot/releases/tag/v${version}`,
    draft: false,
    prerelease: false,
    assets: [{
      name,
      size: 144_000_000,
      browser_download_url: `https://github.com/dotoricode/docpilot/releases/download/v${version}/${name}`,
      digest: `sha256:${'a'.repeat(64)}`,
    }],
    ...overrides.release,
  };
}

test('numeric version comparison does not treat equal or older releases as updates', () => {
  assert.equal(compareVersions('2.0.3', '2.0.2'), 1);
  assert.equal(compareVersions('2.0.2', '2.0.2'), 0);
  assert.equal(compareVersions('2.0.2', '2.0.10'), -1);
  assert.equal(compareVersions('invalid', '2.0.2'), null);
});

test('selects only the exact architecture DMG from the official stable release', () => {
  const selected = selectUpdateRelease(releaseFixture(), {
    currentVersion: '2.0.2',
    arch: 'arm64',
    repository: 'dotoricode/docpilot',
  });

  assert.deepEqual(selected, {
    version: '2.0.3',
    releaseUrl: 'https://github.com/dotoricode/docpilot/releases/tag/v2.0.3',
    asset: {
      name: 'DocPilot-2.0.3-arm64.dmg',
      size: 144_000_000,
      url: 'https://github.com/dotoricode/docpilot/releases/download/v2.0.3/DocPilot-2.0.3-arm64.dmg',
      digest: `sha256:${'a'.repeat(64)}`,
    },
  });
});

test('rejects downgrade, prerelease, missing digest, wrong architecture, host, and size', () => {
  const options = { currentVersion: '2.0.2', arch: 'arm64', repository: 'dotoricode/docpilot' };
  const invalid = [
    releaseFixture({ version: '2.0.1' }),
    releaseFixture({ release: { prerelease: true } }),
    releaseFixture({ release: { assets: [{
      name: 'DocPilot-2.0.3-arm64.dmg',
      size: 144_000_000,
      browser_download_url: 'https://github.com/dotoricode/docpilot/releases/download/v2.0.3/DocPilot-2.0.3-arm64.dmg',
      digest: null,
    }] } }),
    releaseFixture({ arch: 'x64' }),
    releaseFixture({ release: { assets: [{
      name: 'DocPilot-2.0.3-arm64.dmg',
      size: 144_000_000,
      browser_download_url: 'https://example.com/DocPilot-2.0.3-arm64.dmg',
      digest: `sha256:${'a'.repeat(64)}`,
    }] } }),
    releaseFixture({ release: { assets: [{
      name: 'DocPilot-2.0.3-arm64.dmg',
      size: 1024,
      browser_download_url: 'https://github.com/dotoricode/docpilot/releases/download/v2.0.3/DocPilot-2.0.3-arm64.dmg',
      digest: `sha256:${'a'.repeat(64)}`,
    }] } }),
  ];

  for (const fixture of invalid) assert.equal(selectUpdateRelease(fixture, options), null);
});
