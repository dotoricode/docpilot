const path = require('path');
const { fileURLToPath } = require('url');

function isFileUrlForPath(rawUrl, expectedPath) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.protocol !== 'file:') return false;
    return path.resolve(fileURLToPath(url)) === path.resolve(expectedPath);
  } catch {
    return false;
  }
}

function normalizeExternalUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

module.exports = {
  isFileUrlForPath,
  normalizeExternalUrl,
};
