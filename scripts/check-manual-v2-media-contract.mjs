import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'prototypes/manual-v2/content/feature-media-contract.json'), 'utf8'));
const { pages } = await import(path.join(root, 'prototypes/manual-v2/src/content.js'));
const { DOC_ROUTES } = await import(path.join(root, 'prototypes/manual-v2/src/routes.mjs'));

const routeSlugs = DOC_ROUTES.map(route => route.slug);
const contractSlugs = contract.guides.map(guide => guide.slug);

assert.deepEqual([...contractSlugs].sort(), [...routeSlugs].sort(), 'feature media contract must cover every manual route exactly once');
assert.equal(new Set(contractSlugs).size, contractSlugs.length, 'feature media contract contains duplicate routes');

for (const guide of contract.guides) {
  const page = pages[guide.slug];
  assert.ok(page, `${guide.slug} must have page content`);
  for (const evidence of contract.evidenceRequired) {
    assert.ok(guide[evidence]?.trim(), `${guide.slug} must describe ${evidence} evidence`);
  }

  if (guide.media === 'merge') {
    assert.equal(page.redirectTo, guide.target, `${guide.slug} must redirect to its consolidated feature guide`);
    continue;
  }

  assert.ok(Array.isArray(page.media), `${guide.slug} media must be an array`);
  assert.ok(page.media.length > 0, `${guide.slug} must expose at least one media item`);
  const evidence = new Set(page.media.flatMap(item => item.evidence || []));
  for (const required of contract.evidenceRequired) {
    assert.ok(evidence.has(required), `${guide.slug} media must show ${required}`);
  }
  assert.ok(page.media.some(item => item.asset === guide.asset), `${guide.slug} must reference contracted asset ${guide.asset}`);
  for (const item of page.media) {
    assert.ok(['image', 'demo'].includes(item.type), `${guide.slug} has unsupported media type ${item.type}`);
    assert.ok(item.asset && item.label && item.alt, `${guide.slug} media needs asset, label, and alt text`);
  }
}

for (const asset of contract.requiredDemos) {
  const guide = contract.guides.find(item => item.asset === asset);
  const page = guide ? pages[guide.slug] : null;
  assert.ok(page?.media?.some(item => item.type === 'demo' && item.asset === asset), `required demo ${asset} must be assigned as demo media`);
}

console.log(`manual v2 media contract: passed (${contract.guides.length} routes)`);
