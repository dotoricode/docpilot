import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(root, 'prototypes/manual-v2/content/changelog-evidence.json');
const releaseSourcePath = path.join(root, 'prototypes/manual-v2/src/releases.mjs');

assert(fs.existsSync(evidencePath), `Missing changelog evidence: ${evidencePath}`);
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const releaseSource = fs.readFileSync(releaseSourcePath, 'utf8');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

assert.equal(evidence.current.version, packageVersion, 'Evidence version must match package.json');
assert.equal(evidence.current.state, 'release', 'v2 evidence must be prepared for the approved release flow');
assert.equal(evidence.current.tag, `v${packageVersion}`, 'Release evidence must name the intended Git tag');
assert.doesNotMatch(releaseSource, /unreleased:\s*true/, 'Final fallback content must not remain unreleased');
assert.match(releaseSource, new RegExp(`title:\\s*['"]DocPilot ${packageVersion.replace(/\./g, '\\.')}['"]`), 'Fallback title must match the final release');
if (gitTagExists(evidence.current.tag)) {
  const tagVersion = JSON.parse(execFileSync('git', ['show', `${evidence.current.tag}:package.json`], { cwd: root, encoding: 'utf8' })).version;
  assert.equal(tagVersion, packageVersion, 'The published v2 tag must contain the matching package version');
} else {
  assert.match(evidence.current.note, /PR.*tag/i, 'Pre-tag release evidence must explain the PR and tag gate');
}

const requiredFeatures = new Set(['workbench', 'document-modes', 'pane-layout', 'terminal', 'diff-review', 'project-search']);
assert(Array.isArray(evidence.features), 'Evidence must contain feature entries');
for (const feature of evidence.features) {
  requiredFeatures.delete(feature.id);
  assert(feature.claim?.trim(), `${feature.id}: missing bounded public claim`);
  assert(feature.commit, `${feature.id}: implementation commit missing`);
  assert(feature.date, `${feature.id}: implementation date missing`);
  for (const field of ['implementation', 'verification', 'documentation']) {
    assert(Array.isArray(feature[field]) && feature[field].length, `${feature.id}: missing ${field} evidence`);
  }
  for (const file of [...feature.implementation, ...feature.verification, ...feature.documentation]) {
    assert(fs.existsSync(path.join(root, file)), `${feature.id}: evidence file does not exist: ${file}`);
  }
}
assert.equal(requiredFeatures.size, 0, `Missing v2 feature evidence: ${[...requiredFeatures].join(', ')}`);

const requiredFixes = new Set(['preview-typography', 'preview-overflow', 'preview-controls', 'launch-defaults']);
assert(Array.isArray(evidence.fixes), 'Current release evidence must contain fix entries');
for (const fix of evidence.fixes) {
  requiredFixes.delete(fix.id);
  assert(fix.claim?.trim(), `${fix.id}: missing bounded public claim`);
  for (const field of ['implementation', 'verification']) {
    assert(Array.isArray(fix[field]) && fix[field].length, `${fix.id}: missing ${field} evidence`);
    for (const file of fix[field]) assert(fs.existsSync(path.join(root, file)), `${fix.id}: evidence file does not exist: ${file}`);
  }
}
assert.equal(requiredFixes.size, 0, `Missing current fix evidence: ${[...requiredFixes].join(', ')}`);

const commit = execFileSync('git', ['rev-parse', evidence.current.implementationCommit], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(commit, evidence.current.implementationCommit, 'Implementation commit must resolve exactly');
const commitDate = execFileSync('git', ['show', '-s', '--format=%aI', commit], { cwd: root, encoding: 'utf8' }).trim().slice(0, 10);
assert.equal(commitDate, evidence.current.implementationDate, 'Implementation date must match Git author date');

const histories = new Map((evidence.history || []).map(entry => [entry.version, entry]));
for (const version of ['1.0.27', '1.0.28', '2.0.0']) {
  const entry = histories.get(version);
  assert(entry, `Missing historical evidence for ${version}`);
  const tag = `v${version}`;
  assert(gitTagExists(tag), `Missing repository tag ${tag}`);
  const taggedCommit = execFileSync('git', ['rev-parse', `${tag}^{}`], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(entry.commit, taggedCommit, `${version}: tagged commit mismatch`);
  assert(entry.date, `${version}: missing tag date`);
  assert.equal(entry.date, entry.releasePublishedAt.slice(0, 10), `${version}: public date must come from release published_at`);
  const localTagDate = execFileSync('git', ['for-each-ref', `refs/tags/${tag}`, '--format=%(creatordate:short)'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(entry.tagDate, localTagDate, `${version}: tag date mismatch`);
  assert(Array.isArray(entry.claims), `${version}: claims must be explicit even when empty`);
  assert.match(releaseSource, new RegExp(`version:\\s*['\"]${version.replace(/\./g, '\\.')}['\"]`), `${version}: verified history must be present in the local Changelog fallback`);
}

const v127 = histories.get('1.0.27');
assert.equal(v127.baselineOnly, true, 'v1.0.27 must be described as a baseline because no earlier repository tag exists');
const v128 = histories.get('1.0.28');
for (const claim of v128.claims) {
  assert(claim.sourceCommit, 'v1.0.28 claims require a source commit');
  execFileSync('git', ['merge-base', '--is-ancestor', claim.sourceCommit, 'v1.0.28^{}'], { cwd: root, stdio: 'ignore' });
  assert(!isAncestor(claim.sourceCommit, 'v1.0.27^{}'), `v1.0.28 claim predates v1.0.27: ${claim.sourceCommit}`);
}

console.log(`changelog evidence checks passed (${evidence.features.length} v2 features, ${evidence.history.length} historical entries)`);

function gitTagExists(tag) {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isAncestor(commit, target) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, target], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
