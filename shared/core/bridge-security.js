const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function canonicalizeRoot(rootPath) {
  try {
    return fs.realpathSync.native(path.resolve(String(rootPath || '')));
  } catch {
    return null;
  }
}

function isPathInside(rootPath, candidatePath, allowRoot = true) {
  const relative = path.relative(rootPath, candidatePath);
  if (!relative) return allowRoot;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Resolve a workspace-relative path without following symlinks.
 *
 * The root is canonicalized first, and every existing component below it is
 * checked with lstat. Creation routes may opt into one missing final component
 * (the new file/folder name); missing intermediate directories are rejected.
 */
function resolveInsideRoot(rootPath, relativePath, options = {}) {
  const root = canonicalizeRoot(rootPath);
  if (!root) return null;

  const raw = String(relativePath ?? '');
  if (path.isAbsolute(raw)) return null;
  const candidate = path.resolve(root, raw);
  if (!isPathInside(root, candidate, options.allowRoot !== false)) return null;

  const relative = path.relative(root, candidate);
  if (!relative) return root;
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      const missingLeaf = error?.code === 'ENOENT' && options.allowMissingLeaf === true && index === parts.length - 1;
      return missingLeaf ? candidate : null;
    }
    if (stat.isSymbolicLink()) return null;
  }
  return candidate;
}

function isAllowedLoopbackHost(hostHeader, port) {
  const value = String(hostHeader || '').trim().toLowerCase();
  const expectedPort = String(port);
  return value === `127.0.0.1:${expectedPort}`
    || value === `localhost:${expectedPort}`
    || value === `[::1]:${expectedPort}`;
}

function isAllowedRendererOrigin(originHeader) {
  const origin = String(originHeader || '').trim();
  return !origin || origin === 'null';
}

function tokensEqual(expectedToken, providedToken) {
  const expected = Buffer.from(String(expectedToken || ''), 'utf8');
  const provided = Buffer.from(String(providedToken || ''), 'utf8');
  if (!expected.length || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

function bridgeRequestToken(req, url) {
  const header = req?.headers?.['x-docpilot-token'];
  if (Array.isArray(header)) return header[0] || '';
  return String(header || url?.searchParams?.get('token') || '');
}

function isAuthorizedBridgeRequest(req, url, options = {}) {
  if (!isAllowedLoopbackHost(req?.headers?.host, options.port)) return false;
  if (!isAllowedRendererOrigin(req?.headers?.origin)) return false;
  if (options.allowUnauthenticated === true && !options.token) return true;
  return tokensEqual(options.token, bridgeRequestToken(req, url));
}

module.exports = {
  bridgeRequestToken,
  canonicalizeRoot,
  isAllowedLoopbackHost,
  isAllowedRendererOrigin,
  isAuthorizedBridgeRequest,
  isPathInside,
  resolveInsideRoot,
  tokensEqual,
};
