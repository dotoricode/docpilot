import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manual = path.join(root, 'prototypes/manual-v2');
const vercelConfigPath = path.join(root, 'vercel.json');
const vercelIgnorePath = path.join(root, '.vercelignore');

assert.ok(fs.existsSync(vercelConfigPath), 'Vercel deployment config is missing');
assert.ok(fs.existsSync(vercelIgnorePath), 'Vercel upload ignore config is missing');
const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));
const vercelIgnore = fs.readFileSync(vercelIgnorePath, 'utf8');
assert.equal(vercelConfig.installCommand, 'npm --prefix prototypes/manual-v2 ci');
assert.equal(vercelConfig.buildCommand, 'npm --prefix prototypes/manual-v2 run build');
assert.equal(vercelConfig.outputDirectory, 'prototypes/manual-v2/dist');
assert.match(vercelIgnore, /^\/\*$/m, 'Vercel upload must deny root files by default');
assert.match(vercelIgnore, /^!prototypes\/manual-v2$/m, 'Vercel upload must include the manual source');

const requiredFiles = [
  'src/App.jsx',
  'src/content.js',
  'src/routes.mjs',
  'src/releases.mjs',
  'src/styles.css',
  'scripts/materialize-routes.mjs',
];
for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(manual, file)), `missing manual implementation file: ${file}`);
}

const { DOC_ROUTES, canonicalPath, matchRoute, routePaths } = await import(path.join(manual, 'src/routes.mjs'));
const { fetchReleases, normalizeRelease, selectDmgAsset } = await import(path.join(manual, 'src/releases.mjs'));

assert.ok(DOC_ROUTES.length >= 20, 'the v2 manual must provide a complete task-oriented guide set');
assert.equal(new Set(DOC_ROUTES.map(route => route.path)).size, DOC_ROUTES.length, 'documentation routes must be unique');
assert.equal(canonicalPath({ kind: 'docs', slug: 'editing/markdown' }), '/docs/editing/markdown');
assert.deepEqual(matchRoute('/docs/editing/markdown/'), { kind: 'docs', slug: 'editing/markdown' });
assert.deepEqual(matchRoute('/docpilot-manual.html'), { kind: 'docs', slug: 'overview' });
assert.deepEqual(matchRoute('/changelog/2.0.0'), { kind: 'release', version: '2.0.0' });
assert.deepEqual(matchRoute('/changelog/2.0.1'), { kind: 'release', version: '2.0.1' });
assert.ok(routePaths().includes('/changelog'));
assert.ok(routePaths(['2.0.1', '2.0.0']).includes('/changelog/2.0.1'), 'versioned release routes must be materialized for clean reloads');
assert.deepEqual(matchRoute('/docpilot-manual-preview/docs/editing/markdown', '/docpilot-manual-preview/'), { kind: 'docs', slug: 'editing/markdown' });

const fixtureRelease = normalizeRelease({
  tag_name: 'v2.0.1',
  name: 'DocPilot 2.0.1',
  body: '## Added\n- Public manual',
  published_at: '2026-07-15T00:00:00Z',
  assets: [
    { name: 'DocPilot-2.0.1.dmg.blockmap', browser_download_url: 'https://example.test/blockmap' },
    { name: 'DocPilot-2.0.1.dmg', browser_download_url: 'https://example.test/DocPilot-2.0.1.dmg' },
  ],
});
assert.equal(fixtureRelease.version, '2.0.1');
assert.equal(selectDmgAsset(fixtureRelease.assets).url, 'https://example.test/DocPilot-2.0.1.dmg');
assert.equal(selectDmgAsset(fixtureRelease.assets).name, 'DocPilot-2.0.1.dmg');
const mergedReleases = await fetchReleases(async () => ({
  ok: true,
  json: async () => [{ tag_name: 'v1.0.28', name: 'DocPilot 1.0.28', body: 'Stable', published_at: '2026-07-14', assets: [] }],
}));
assert.deepEqual(mergedReleases.map(release => release.version), ['2.0.1', '2.0.0', '1.0.28', '1.0.27'], 'verified v2 and v1 history must remain visible when remote data is partial');
assert.match(mergedReleases.find(release => release.version === '1.0.28').summary, /AsciiDoc/, 'v1.0.28 must expose its verified feature summary');
assert.match(mergedReleases.find(release => release.version === '1.0.27').body, /baseline|기준선/i, 'v1.0.27 must be described as a verified baseline');

const app = fs.readFileSync(path.join(manual, 'src/App.jsx'), 'utf8');
const content = fs.readFileSync(path.join(manual, 'src/content.js'), 'utf8');
const styles = fs.readFileSync(path.join(manual, 'src/styles.css'), 'utf8');
const visibleSource = `${app}\n${content}`;

for (const label of ['Docs', 'Changelog', 'Download']) {
  assert.ok(app.includes(label), `header action missing: ${label}`);
}
assert.ok(app.includes('window.location.assign(asset.url)'), 'Download must navigate directly to the selected DMG asset');
for (const forbidden of ['Star', 'Enterprise', 'View on GitHub', 'GitHub에서']) {
  assert.ok(!visibleSource.includes(forbidden), `public manual exposes forbidden GitHub/social UI: ${forbidden}`);
}
for (const token of [
  '--background: #f5f5f5',
  '--foreground: #0a0a0a',
  '--background: #121212',
  '--foreground: #ebebeb',
  '--card: #191919',
  '--border: #6663',
]) {
  assert.ok(styles.includes(token), `captured Orca Docs color token missing: ${token}`);
}
assert.match(styles, /grid-template-columns:\s*268px\s+minmax\(0,\s*1fr\)/, 'desktop documentation rail must match the captured 268px geometry');
assert.match(styles, /@media\s*\(max-width:\s*760px\)/, 'mobile documentation layout missing');
assert.ok(app.includes('Cmd/Ctrl+K') || app.includes('metaKey') && app.includes('ctrlKey'), 'keyboard search shortcut missing');
assert.ok(app.includes('prefers-reduced-motion'), 'reduced-motion demo fallback missing');

console.log('manual v2 Orca parity contract: passed');
