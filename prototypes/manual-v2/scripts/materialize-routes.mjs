import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALLBACK_RELEASES, fetchReleases } from '../src/releases.mjs';
import { routePaths } from '../src/routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const indexPath = path.join(dist, 'index.html');
if (!fs.existsSync(indexPath)) throw new Error('Build output is missing dist/index.html');

const html = fs.readFileSync(indexPath, 'utf8');
const releaseVersions = await loadReleaseVersions();
const routes = routePaths(releaseVersions);
for (const route of routes) {
  const target = path.join(dist, route.replace(/^\/+/, ''), 'index.html');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
}
fs.writeFileSync(path.join(dist, '404.html'), html);
fs.writeFileSync(path.join(dist, 'route-manifest.json'), JSON.stringify(routes, null, 2));
console.log(`materialized ${routes.length} manual routes`);

async function loadReleaseVersions() {
  try {
    return (await fetchReleases()).map(release => release.version);
  } catch {
    return FALLBACK_RELEASES.map(release => release.version);
  }
}
