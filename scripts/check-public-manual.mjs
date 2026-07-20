import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const targets = [
  { name: 'GitHub Pages', baseUrl: process.env.DOCPILOT_GITHUB_PAGES_URL || 'https://dotoricode.github.io/docpilot/' },
  { name: 'Vercel', baseUrl: process.env.DOCPILOT_VERCEL_URL || 'https://docpilot-manual.vercel.app/' },
];

for (const target of targets) {
  const baseUrl = new URL(target.baseUrl);
  const homeUrl = new URL(baseUrl);
  homeUrl.searchParams.set('release-check', String(Date.now()));
  const home = await fetchText(homeUrl);
  const scriptPath = [...home.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)][0]?.[1];
  assert.ok(scriptPath, `${target.name}: production HTML does not reference a JavaScript bundle`);

  const bundle = await fetchText(new URL(scriptPath, baseUrl));
  assert.match(bundle, new RegExp(`DocPilot ${escapeRegExp(version)}`), `${target.name}: bundle does not contain v${version}`);
  assert.match(bundle, /Apple Silicon/, `${target.name}: Apple Silicon download option is missing`);
  assert.match(bundle, /Intel Mac/, `${target.name}: Intel download option is missing`);
  assert.match(bundle, /개인정보 보호 및 보안/, `${target.name}: official macOS privacy and security path is missing`);
  assert.match(bundle, /확인 없이 열기/, `${target.name}: unsigned Open Anyway guidance is missing`);

  const changelogUrl = new URL(`changelog/${version}/`, baseUrl);
  await fetchText(changelogUrl);
  console.log(`${target.name} public manual v${version}: passed (${baseUrl})`);
}

const release = await fetchJson('https://api.github.com/repos/dotoricode/docpilot/releases/latest');
assert.equal(release.tag_name, `v${version}`, `latest GitHub Release must be v${version}`);
const assetNames = new Set((release.assets || []).map(asset => asset.name));
for (const arch of ['arm64', 'x64']) {
  assert.ok(assetNames.has(`DocPilot-${version}-${arch}.dmg`), `latest release is missing ${arch} DMG`);
}
console.log(`latest GitHub Release v${version}: passed`);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'DocPilot-release-verifier' },
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.ok, true, `${url}: expected success, got ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DocPilot-release-verifier' },
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.ok, true, `${url}: expected success, got ${response.status}`);
  return response.json();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
