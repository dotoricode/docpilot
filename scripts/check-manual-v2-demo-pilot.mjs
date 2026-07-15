import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specPath = path.join(root, 'prototypes/manual-v2/content/demo-motion-spec.json');
const pilotRoot = path.join(root, '.tink/current/artifacts/demo-pilot');
const videoPath = path.join(pilotRoot, 'pane-layout-pilot.mp4');
const posterPath = path.join(pilotRoot, 'pane-layout-pilot.jpg');
const contactPath = path.join(pilotRoot, 'pane-layout-pilot-contact.jpg');

assert(fs.existsSync(specPath), `Missing demo motion specification: ${specPath}`);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
assert.equal(spec.version, 1, 'Motion specification version must be explicit');
assert.deepEqual(spec.capture.viewport, { width: 1440, height: 900 });
assert.equal(spec.capture.fps, 30);
assert(spec.rules.zoom.transitionMs.min >= 250 && spec.rules.zoom.transitionMs.max <= 450, 'Zoom transitions must stay within the approved 250-450ms range');
assert(spec.rules.zoom.focusScale.min >= 1.25 && spec.rules.zoom.focusScale.max <= 1.55, 'Focus scale must stay within the approved 1.25-1.55 range');
assert(spec.rules.camera.maxMovesPerClip <= 2, 'Pilot may use at most two camera moves');
assert.equal(spec.rules.interaction.speed, 1, 'Cursor, drag, and layout changes must remain real-time');
assert(spec.rules.resultHoldMs.min >= 1000, 'Final result must remain readable for at least one second');

const pilot = spec.scenarios?.paneLayout;
assert(pilot, 'Missing paneLayout scenario');
assert.deepEqual(pilot.phases.map(phase => phase.kind), ['input', 'focus', 'action', 'preview', 'drop', 'result']);
assert(pilot.phases.every(phase => phase.durationMs >= 250), 'Every visible phase must be followable');
assert.equal(pilot.camera.length, 2, 'Pane pilot must focus once and return to overview once');
assert(pilot.camera[0].toScale > 1 && pilot.camera[1].toScale === 1, 'Camera must focus on the tab then return to overview');

for (const file of [videoPath, posterPath, contactPath]) assert(fs.existsSync(file), `Missing pilot artifact: ${file}`);
const probe = JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate:format=duration',
  '-of', 'json', videoPath,
], { cwd: root, encoding: 'utf8' }));
const stream = probe.streams?.[0] || {};
const duration = Number(probe.format?.duration || 0);
assert.equal(stream.width, 1440, 'Pilot width must remain 1440');
assert.equal(stream.height, 900, 'Pilot height must remain 900');
assert(Math.abs(rate(stream.avg_frame_rate || stream.r_frame_rate) - 30) < 0.1, 'Pilot must be 30fps');
assert(duration >= 4 && duration <= 8, `Pilot duration must be 4-8 seconds, got ${duration}`);

console.log(`demo pilot checks passed (${duration.toFixed(2)}s, ${stream.width}x${stream.height} @ ${rate(stream.avg_frame_rate).toFixed(2)}fps)`);

function rate(value = '0/1') {
  const [numerator, denominator] = String(value).split('/').map(Number);
  return denominator ? numerator / denominator : 0;
}
