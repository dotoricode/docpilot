const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manual = path.join(root, 'prototypes/manual-v2');
const app = fs.readFileSync(path.join(manual, 'src/App.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(manual, 'src/styles.css'), 'utf8');
const content = fs.readFileSync(path.join(manual, 'src/content.js'), 'utf8');

for (const contract of [
  'routeFromLocation',
  'navigateTo',
  'fetchReleases',
  'resolveLatestDmg',
  'SearchDialog',
  'MediaFrame',
  'IntersectionObserver',
  'prefers-reduced-motion',
  'docpilot-manual-theme',
  'Download',
]) {
  assert.ok(`${app}\n${styles}`.includes(contract), `prototype contract missing: ${contract}`);
}

assert.match(styles, /--background:\s*#f5f5f5/);
assert.match(styles, /:root\[data-theme='dark'\][\s\S]*--background:\s*#121212/);
assert.match(styles, /grid-template-columns:\s*268px\s+minmax\(0,\s*1fr\)/);
assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
assert.ok((content.match(/description:/g) || []).length >= 25, 'manual content is incomplete');
assert.doesNotMatch(app, /<video[\s\S]{0,220}\sloop(?:\s|=|>)/, 'manual demos must not loop continuously');
assert.ok(fs.existsSync(path.join(manual, 'scripts/materialize-routes.mjs')), 'route materializer missing');

console.log('manual v2 prototype contract: passed');
