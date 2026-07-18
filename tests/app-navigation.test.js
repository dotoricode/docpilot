const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const { isFileUrlForPath, normalizeExternalUrl } = require('../shared/core/app-navigation');

test('privileged renderer navigation matches the exact local file', () => {
  const expected = path.resolve('/tmp/docpilot/dist/renderer/index.html');
  assert.equal(isFileUrlForPath(`${pathToFileURL(expected).href}?port=7474`, expected), true);
  assert.equal(isFileUrlForPath('https://attacker.test/index.html', expected), false);
  assert.equal(isFileUrlForPath(pathToFileURL('/tmp/attacker/index.html').href, expected), false);
});

test('external URLs are restricted to credential-free HTTP(S)', () => {
  assert.equal(normalizeExternalUrl('https://github.com/dotoricode/docpilot'), 'https://github.com/dotoricode/docpilot');
  assert.equal(normalizeExternalUrl('file:///etc/passwd'), null);
  assert.equal(normalizeExternalUrl('javascript:alert(1)'), null);
  assert.equal(normalizeExternalUrl('https://user:secret@example.com/'), null);
});
