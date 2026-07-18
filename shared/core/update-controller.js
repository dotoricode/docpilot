'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { downloadVerifiedAsset, uniqueDownloadPath } = require('./update-download');
const { selectUpdateRelease } = require('./update-release');

function createUpdateController(options = {}) {
  const {
    repository,
    currentVersion,
    arch,
    downloadsDirectory,
    fetchRelease,
    fetchAsset,
    openPath,
    onState = () => {},
  } = options;
  let selectedRelease = null;
  let downloadedPath = '';
  let downloadPromise = null;
  let state = { status: 'idle' };

  function publicReleaseState(status, extra = {}) {
    if (!selectedRelease) return { status, ...extra };
    return {
      status,
      version: selectedRelease.version,
      releaseUrl: selectedRelease.releaseUrl,
      fileName: selectedRelease.asset.name,
      size: selectedRelease.asset.size,
      ...extra,
    };
  }

  function publish(nextState) {
    state = Object.freeze({ ...nextState });
    onState({ ...state });
    return { ...state };
  }

  async function check() {
    const payload = await fetchRelease();
    const nextRelease = selectUpdateRelease(payload, { repository, currentVersion, arch });
    if (!nextRelease) return { ...state };
    if (selectedRelease?.version === nextRelease.version && (downloadPromise || downloadedPath)) {
      return { ...state };
    }
    selectedRelease = nextRelease;
    return publish(publicReleaseState('available'));
  }

  async function download() {
    if (!selectedRelease) throw new Error('사용 가능한 업데이트를 먼저 확인해주세요.');
    if (state.status === 'downloaded' && downloadedPath) return { ...state };
    if (downloadPromise) return downloadPromise;

    const directory = downloadsDirectory();
    const destination = uniqueDownloadPath(directory, selectedRelease.asset.name);
    publish(publicReleaseState('downloading', { received: 0, percent: 0 }));
    downloadPromise = downloadVerifiedAsset({
      asset: selectedRelease.asset,
      destination,
      fetchImpl: fetchAsset,
      onProgress: progress => publish(publicReleaseState('downloading', progress)),
    }).then(result => {
      downloadedPath = result.path;
      return publish(publicReleaseState('downloaded', {
        received: result.size,
        percent: 100,
        digest: result.digest,
      }));
    }).catch(error => {
      publish(publicReleaseState('error', {
        error: error instanceof Error ? error.message : '업데이트 다운로드에 실패했습니다.',
      }));
      throw error;
    }).finally(() => {
      downloadPromise = null;
    });
    return downloadPromise;
  }

  async function openDownloaded() {
    if (!downloadedPath || state.status !== 'downloaded' || !fs.existsSync(downloadedPath)) {
      throw new Error('다운로드된 업데이트를 찾지 못했습니다.');
    }
    const error = await openPath(downloadedPath);
    if (error) throw new Error(String(error));
    return true;
  }

  return {
    check,
    download,
    getState: () => ({ ...state }),
    openDownloaded,
    downloadedFileName: () => downloadedPath ? path.basename(downloadedPath) : '',
  };
}

module.exports = { createUpdateController };
