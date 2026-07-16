const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manualRoot = path.join(root, 'prototypes/manual-v2');
const demoRoot = path.join(manualRoot, 'public/media/demos');
const imageRoot = path.join(manualRoot, 'public/media/images');
const reviewRoot = path.join(root, '.tink/current/artifacts/demo-processed');
const rawRoot = path.join(root, '.tink/current/artifacts/demo-raw');
const metadata = readJson(path.join(manualRoot, 'content/demo-metadata.json'));
const contract = readJson(path.join(manualRoot, 'content/feature-media-contract.json'));
const motion = readJson(path.join(manualRoot, 'content/demo-motion-spec.json'));
const mediaSource = fs.readFileSync(path.join(manualRoot, 'src/media.js'), 'utf8');
const captureSource = fs.readFileSync(path.join(root, 'scripts/capture-manual-v2-demos.js'), 'utf8');
const imageAssets = [...mediaSource.matchAll(/media\('image',\s*'([^']+)'/g)].map(match => match[1]);
const report = { demos: [], images: [] };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function probe(file) {
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=width,height,avg_frame_rate:format=duration,size', '-of', 'json', file,
  ], { encoding: 'utf8' }));
}

assert.equal(motion.rules.interactionAcceleration, false, 'interaction playback must never be accelerated');
assert.equal(motion.rules.loadingAccelerationForPerformanceDemos, false, 'performance loading must remain truthful');
assert.ok(motion.rules.typingDelayMs.min >= 80, 'typing must remain human-followable');
assert.ok(motion.rules.cursorMoveMs.min >= 650, 'pointer movement must remain human-followable');
assert.ok(!captureSource.includes('DOCPILOT_FAKE_AGENT'), 'production demo recorder must never opt into the fake agent shell');
assert.match(captureSource, /typeHuman\(page, 'claude'\)/, 'Claude must be launched by typing in the real terminal');

assert.deepEqual(
  metadata.demos.map(item => item.name).sort(),
  [...contract.requiredDemos].sort(),
  'rendered demo metadata must cover the exact required demo set',
);

for (const name of contract.requiredDemos) {
  for (const extension of ['mp4', 'webm', 'gif', 'jpg']) {
    assert.ok(fs.existsSync(path.join(demoRoot, `${name}.${extension}`)), `missing ${name}.${extension}`);
  }
  assert.ok(fs.existsSync(path.join(reviewRoot, `${name}-contact.jpg`)), `missing ${name} contact sheet`);

  const evidence = metadata.demos.find(item => item.name === name);
  assert.ok(evidence?.goal && evidence?.outcome, `${name} metadata must state the feature goal and outcome`);
  assert.ok(evidence.phases.includes('inputEnd') && evidence.phases.includes('resultEnd'), `${name} must preserve input and result marks`);

  const master = probe(path.join(demoRoot, `${name}.mp4`));
  const web = probe(path.join(demoRoot, `${name}.webm`));
  const poster = probe(path.join(demoRoot, `${name}.jpg`));
  const duration = Number(master.format.duration);
  const [fpsNumerator, fpsDenominator] = master.streams[0].avg_frame_rate.split('/').map(Number);
  const fps = fpsNumerator / fpsDenominator;

  assert.equal(master.streams[0].width, 1440, `${name} master width`);
  assert.equal(master.streams[0].height, 900, `${name} master height`);
  assert.ok(duration >= 5 && duration <= 35, `${name} duration ${duration}s is outside the 5–35s workflow range`);
  assert.ok(Math.abs(duration - evidence.durationSeconds) <= 0.1, `${name} metadata duration must match the rendered master`);
  assert.ok(fps >= 29 && fps <= 31, `${name} master frame rate is ${fps}`);
  assert.equal(web.streams[0].width, 960, `${name} web width`);
  assert.equal(poster.streams[0].width, 1440, `${name} poster width`);
  assert.equal(poster.streams[0].height, 900, `${name} poster height`);
  assert.ok(fs.statSync(path.join(demoRoot, `${name}.gif`)).size < 5_000_000, `${name}.gif exceeds 5 MB`);
  report.demos.push({ name, duration, fps, masterBytes: Number(master.format.size), webBytes: Number(web.format.size) });
}

assert.ok(report.demos.find(item => item.name === 'tabs-and-panes-all-directions').duration >= 20, 'pane demo must show every direction');
assert.ok(report.demos.find(item => item.name === 'diff-edit-to-changes').duration >= 15, 'Diff demo must include editing and Changes review');
assert.ok(report.demos.find(item => item.name === 'preview-context-to-claude').duration >= 25, 'Claude transfer must remain readable');

const contextRaw = readJson(path.join(rawRoot, 'preview-context-to-claude.json'));
assert.deepEqual(
  { file: contextRaw.phaseMarks.copiedContext.file, line: contextRaw.phaseMarks.copiedContext.line, body: contextRaw.phaseMarks.copiedContext.body },
  { file: true, line: true, body: true },
  'Claude clipboard payload must contain file, line, and body',
);
assert.ok(contextRaw.phaseMarks.copiedContext.characters >= 60, 'Claude clipboard payload must contain meaningful context');

const asciidocRaw = readJson(path.join(rawRoot, 'asciidoc-long-cold-cache.json'));
assert.ok(asciidocRaw.phaseMarks.coldLoadMs > 0, 'AsciiDoc cold loading must be measured');
assert.ok(asciidocRaw.phaseMarks.cachedLoadMs > 0, 'AsciiDoc cached loading must be measured');
assert.ok(asciidocRaw.phaseMarks.cachedLoadMs < asciidocRaw.phaseMarks.coldLoadMs, 'AsciiDoc cached loading must be faster than cold loading');

assert.ok(imageAssets.length >= 16, 'every static feature guide must declare an actual-app image');
assert.equal(new Set(imageAssets).size, imageAssets.length, 'static image assets must be uniquely named');
for (const name of imageAssets) {
  const file = path.join(imageRoot, `${name}.jpg`);
  assert.ok(fs.existsSync(file), `missing ${name}.jpg`);
  const image = probe(file);
  assert.equal(image.streams[0].width, 1440, `${name} image width`);
  assert.equal(image.streams[0].height, 900, `${name} image height`);
  assert.ok(fs.statSync(file).size >= 40_000, `${name}.jpg is too small to be an actual-app capture`);
  report.images.push({ name, bytes: Number(image.format.size) });
}

console.log(JSON.stringify({ result: 'passed', ...report }, null, 2));
