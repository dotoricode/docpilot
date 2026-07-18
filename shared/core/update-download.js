'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const TRUSTED_DELIVERY_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function isTrustedDeliveryUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && TRUSTED_DELIVERY_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function uniqueDownloadPath(directory, fileName) {
  const parsed = path.parse(path.basename(fileName));
  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index ? ` (${index})` : '';
    const candidate = path.join(directory, `${parsed.name}${suffix}${parsed.ext}`);
    if (!fs.existsSync(candidate) && !fs.existsSync(`${candidate}.part`)) return candidate;
  }
  throw new Error('다운로드 파일 이름을 준비하지 못했습니다.');
}

async function downloadVerifiedAsset({ asset, destination, fetchImpl, onProgress = () => {}, signal }) {
  if (!asset || !isTrustedDeliveryUrl(asset.url)) throw new Error('신뢰할 수 없는 업데이트 주소입니다.');
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('업데이트 파일 크기가 올바르지 않습니다.');
  const digestMatch = String(asset.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
  if (!digestMatch) throw new Error('업데이트 SHA-256 정보가 없습니다.');
  if (typeof fetchImpl !== 'function') throw new Error('업데이트 다운로드를 시작하지 못했습니다.');

  const response = await fetchImpl(asset.url, { redirect: 'follow', signal });
  const finalUrl = response?.url || asset.url;
  if (!isTrustedDeliveryUrl(finalUrl)) throw new Error('신뢰할 수 없는 다운로드 경로로 이동했습니다.');
  if (!response?.ok || response.status !== 200 || !response.body) {
    throw new Error(`업데이트 다운로드에 실패했습니다 (${response?.status || 'network'}).`);
  }
  const statedLength = Number(response.headers?.get?.('content-length') || 0);
  if (statedLength && statedLength !== asset.size) throw new Error('업데이트 파일 크기가 릴리즈 정보와 다릅니다.');

  const partialPath = `${destination}.part`;
  const hash = crypto.createHash('sha256');
  let received = 0;
  let lastReportedAt = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > asset.size) {
        callback(new Error('업데이트 파일이 릴리즈 크기를 초과했습니다.'));
        return;
      }
      hash.update(chunk);
      const now = Date.now();
      if (now - lastReportedAt >= 100 || received === asset.size) {
        lastReportedAt = now;
        onProgress({
          received,
          total: asset.size,
          percent: Math.min(100, Math.round((received / asset.size) * 100)),
        });
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      meter,
      fs.createWriteStream(partialPath, { flags: 'wx' }),
      { signal },
    );
    if (received !== asset.size) throw new Error('업데이트 파일 크기가 릴리즈 정보와 다릅니다.');
    const actualDigest = `sha256:${hash.digest('hex')}`;
    if (actualDigest !== `sha256:${digestMatch[1].toLowerCase()}`) {
      throw new Error('업데이트 SHA-256 검증에 실패했습니다.');
    }
    await fs.promises.link(partialPath, destination);
    await fs.promises.unlink(partialPath);
    return { path: destination, size: received, digest: actualDigest };
  } catch (error) {
    await fs.promises.rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  downloadVerifiedAsset,
  isTrustedDeliveryUrl,
  uniqueDownloadPath,
};
