const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  isAllowedLoopbackHost,
  isAuthorizedBridgeRequest,
  resolveInsideRoot,
  tokensEqual,
} = require('../shared/core/bridge-security');

test('bridge authorization requires loopback host, opaque renderer origin, and capability token', () => {
  const url = new URL('http://localhost:7474/files');
  const request = { headers: { host: 'localhost:7474', origin: 'null', 'x-docpilot-token': 'secret-token' } };

  assert.equal(isAuthorizedBridgeRequest(request, url, { port: 7474, token: 'secret-token' }), true);
  assert.equal(isAuthorizedBridgeRequest({ ...request, headers: { ...request.headers, host: 'attacker.test' } }, url, { port: 7474, token: 'secret-token' }), false);
  assert.equal(isAuthorizedBridgeRequest({ ...request, headers: { ...request.headers, origin: 'https://attacker.test' } }, url, { port: 7474, token: 'secret-token' }), false);
  assert.equal(isAuthorizedBridgeRequest({ ...request, headers: { ...request.headers, 'x-docpilot-token': 'wrong-token' } }, url, { port: 7474, token: 'secret-token' }), false);
});

test('event streams may carry the same capability in the query string', () => {
  const url = new URL('http://127.0.0.1:8123/watch?token=query-secret');
  const request = { headers: { host: '127.0.0.1:8123', origin: 'null' } };
  assert.equal(isAuthorizedBridgeRequest(request, url, { port: 8123, token: 'query-secret' }), true);
});

test('token and loopback checks fail closed', () => {
  assert.equal(tokensEqual('', ''), false);
  assert.equal(tokensEqual('abc', 'abcd'), false);
  assert.equal(isAllowedLoopbackHost('localhost:7474', 7474), true);
  assert.equal(isAllowedLoopbackHost('localhost:7475', 7474), false);
});

test('workspace resolver rejects traversal and symlink escapes', t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-path-guard-'));
  const root = path.join(sandbox, 'root');
  const outside = path.join(sandbox, 'outside');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'ok.md'), 'ok');
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret');
  fs.symlinkSync(outside, path.join(root, 'linked'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  assert.equal(resolveInsideRoot(root, 'docs/ok.md'), path.join(root, 'docs', 'ok.md'));
  assert.equal(resolveInsideRoot(root, '../outside/secret.md'), null);
  assert.equal(resolveInsideRoot(root, 'linked/secret.md'), null);
  assert.equal(resolveInsideRoot(root, 'docs/new.md', { allowMissingLeaf: true }), path.join(root, 'docs', 'new.md'));
  assert.equal(resolveInsideRoot(root, 'missing/new.md', { allowMissingLeaf: true }), null);
});
