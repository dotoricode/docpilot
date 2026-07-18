'use strict';

const MIN_DMG_BYTES = 50 * 1024 * 1024;
const MAX_DMG_BYTES = 1024 * 1024 * 1024;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_DIGEST = /^sha256:([a-f0-9]{64})$/i;

function versionParts(version) {
  const match = String(version || '').match(STABLE_VERSION);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function selectUpdateRelease(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || payload.draft || payload.prerelease) return null;
  const repository = String(options.repository || '');
  const arch = String(options.arch || '');
  const currentVersion = String(options.currentVersion || '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
  if (arch !== 'arm64' && arch !== 'x64') return null;

  const tag = String(payload.tag_name || '');
  const version = tag.startsWith('v') ? tag.slice(1) : '';
  if (compareVersions(version, currentVersion) !== 1) return null;

  const releaseUrl = `https://github.com/${repository}/releases/tag/v${version}`;
  if (payload.html_url !== releaseUrl) return null;

  const name = `DocPilot-${version}-${arch}.dmg`;
  const assetUrl = `https://github.com/${repository}/releases/download/v${version}/${name}`;
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const asset = assets.find(candidate => candidate?.name === name);
  if (!asset || asset.browser_download_url !== assetUrl) return null;
  if (!Number.isSafeInteger(asset.size) || asset.size < MIN_DMG_BYTES || asset.size > MAX_DMG_BYTES) return null;
  const digestMatch = String(asset.digest || '').match(SHA256_DIGEST);
  if (!digestMatch) return null;

  return {
    version,
    releaseUrl,
    asset: {
      name,
      size: asset.size,
      url: assetUrl,
      digest: `sha256:${digestMatch[1].toLowerCase()}`,
    },
  };
}

module.exports = {
  MAX_DMG_BYTES,
  MIN_DMG_BYTES,
  compareVersions,
  selectUpdateRelease,
};
