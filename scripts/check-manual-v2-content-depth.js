const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const root = path.resolve(__dirname, '..');
  const manual = path.join(root, 'prototypes/manual-v2');
  const content = await import(`${pathToFileURL(path.join(manual, 'src/content.js')).href}?audit=${Date.now()}`);
  const routes = await import(`${pathToFileURL(path.join(manual, 'src/routes.mjs')).href}?audit=${Date.now()}`);
  const { pages } = content;

  assert.equal(routes.DOC_ROUTES.length, 25, 'manual must expose the complete verified guide set');
  assert.equal(Object.keys(pages).length, 25, 'every route must have content');

  for (const route of routes.DOC_ROUTES) {
    const page = pages[route.slug];
    assert.ok(page, `${route.slug}: content is missing`);
    assert.ok(page.description?.length >= 35, `${route.slug}: description is too vague`);
    assert.ok(page.outcome?.length >= 20, `${route.slug}: outcome is missing or too vague`);
    assert.ok(Array.isArray(page.sections) && page.sections.length >= 2, `${route.slug}: sections are incomplete`);
    const combinedItems = page.sections.flatMap(section => section.items || []);
    assert.ok(combinedItems.length >= 4, `${route.slug}: actionable and recovery guidance is incomplete`);
  }

  const evidence = fs.readFileSync(path.join(manual, 'content/docpilot-feature-evidence.md'), 'utf8');
  for (const route of routes.DOC_ROUTES) {
    assert.ok(evidence.includes(route.path), `${route.slug}: repository evidence mapping is missing`);
  }

  const appSource = fs.readFileSync(path.join(manual, 'src/App.jsx'), 'utf8');
  assert.match(appSource, /fetchReleases/);
  assert.match(appSource, /resolveLatestDmg/);
  assert.match(appSource, /ReleaseDetail/);
  assert.doesNotMatch(appSource, /View on GitHub|GitHub에서/);

  console.log('manual v2 content depth audit passed');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
