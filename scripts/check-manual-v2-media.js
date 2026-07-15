const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mediaRoot = path.join(root, 'prototypes/manual-v2/public/media/demos');
const reviewRoot = path.join(root, '.tink/current/artifacts/demo-processed');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'prototypes/manual-v2/content/demo-metadata.json'), 'utf8'));
const scenarios = ['workbench', 'split', 'terminal', 'diff', 'search', 'guide-split'];
const report = [];
const durations = [];

function probe(file) {
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=width,height,avg_frame_rate:format=duration,size', '-of', 'json', file,
  ], { encoding: 'utf8' }));
}

for (const name of scenarios) {
  for (const extension of ['mp4', 'webm', 'gif', 'jpg']) {
    assert.ok(fs.existsSync(path.join(mediaRoot, `${name}.${extension}`)), `missing ${name}.${extension}`);
  }
  assert.ok(fs.existsSync(path.join(reviewRoot, `${name}-contact.jpg`)), `missing ${name} contact sheet`);

  const evidence = metadata.demos.find(item => item.name === name);
  assert.ok(evidence?.goal && evidence?.outcome, `${name} metadata must state the feature goal and outcome`);
  assert.ok(evidence.phases.includes('inputEnd') && evidence.phases.includes('resultEnd'), `${name} metadata must preserve input and result phase marks`);

  const master = probe(path.join(mediaRoot, `${name}.mp4`));
  const web = probe(path.join(mediaRoot, `${name}.webm`));
  const poster = probe(path.join(mediaRoot, `${name}.jpg`));
  const duration = Number(master.format.duration);
  const [fpsNumerator, fpsDenominator] = master.streams[0].avg_frame_rate.split('/').map(Number);
  const fps = fpsNumerator / fpsDenominator;

  assert.equal(master.streams[0].width, 1440, `${name} master width`);
  assert.equal(master.streams[0].height, 900, `${name} master height`);
  assert.ok(duration >= 4 && duration <= 10, `${name} duration ${duration}s is outside the adaptive 4–10s range`);
  assert.ok(fps >= 29 && fps <= 31, `${name} master frame rate is ${fps}`);
  assert.equal(web.streams[0].width, 960, `${name} web width`);
  assert.equal(poster.streams[0].width, 1440, `${name} poster width`);
  assert.equal(poster.streams[0].height, 900, `${name} poster height`);
  assert.ok(fs.statSync(path.join(mediaRoot, `${name}.gif`)).size < 5_000_000, `${name}.gif exceeds 5 MB`);

  report.push({ name, duration, fps, masterBytes: Number(master.format.size), webBytes: Number(web.format.size) });
  durations.push(duration);
}

assert.ok(new Set(durations.map(value => value.toFixed(1))).size >= 4, 'demo durations must reflect workflow-specific pacing instead of one uniform target');

console.log(JSON.stringify({ result: 'passed', report }, null, 2));
