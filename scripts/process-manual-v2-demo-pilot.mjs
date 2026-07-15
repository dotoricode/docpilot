import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'prototypes/manual-v2/content/demo-motion-spec.json'), 'utf8'));
const scenario = spec.scenarios.paneLayout;
const artifactRoot = path.join(root, '.tink/current/artifacts/demo-pilot');
const rawPath = path.join(artifactRoot, 'pane-layout-raw.webm');
const rawMetadataPath = path.join(artifactRoot, 'pane-layout-raw.json');
const outputPath = path.join(artifactRoot, 'pane-layout-pilot.mp4');
const posterPath = path.join(artifactRoot, 'pane-layout-pilot.jpg');
const contactPath = path.join(artifactRoot, 'pane-layout-pilot-contact.jpg');

if (!fs.existsSync(rawPath) || !fs.existsSync(rawMetadataPath)) {
  throw new Error('Capture the Pane pilot before processing it.');
}

const metadata = JSON.parse(fs.readFileSync(rawMetadataPath, 'utf8'));
const rawDuration = Number(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', rawPath,
], { encoding: 'utf8' }).trim());
const duration = metadata.measuredScenarioDurationMs / 1000;
const trimStart = Math.max(0, rawDuration - duration - metadata.postScenarioHoldMs / 1000);
const fps = spec.capture.fps;
const focusIn = scenario.camera[0];
const focusOut = scenario.camera[1];
const zoomDelta = focusIn.toScale - 1;
const focusStartFrame = frame(metadata.phaseMarks.inputEnd);
const focusEndFrame = frame(metadata.phaseMarks.inputEnd + focusIn.durationMs);
const overviewStartMs = metadata.phaseMarks.focusEnd + Math.min(300, (metadata.phaseMarks.actionEnd - metadata.phaseMarks.focusEnd) * 0.35);
const overviewStartFrame = frame(overviewStartMs);
const overviewEndFrame = frame(overviewStartMs + focusOut.durationMs);
const focusProgress = progressExpression(focusStartFrame, focusEndFrame);
const overviewProgress = progressExpression(overviewStartFrame, overviewEndFrame);
const zoom = [
  `if(lt(on,${focusStartFrame}),1`,
  `if(lt(on,${focusEndFrame}),1+${zoomDelta}*${smoothstep(focusProgress)}`,
  `if(lt(on,${overviewStartFrame}),${focusIn.toScale}`,
  `if(lt(on,${overviewEndFrame}),${focusIn.toScale}-${zoomDelta}*${smoothstep(overviewProgress)},1))))`,
].join(',');

const sourcePoint = metadata.geometry.sourcePoint;
const scale = 4 / 3;
const targetX = Number((sourcePoint.x * scale).toFixed(2));
const targetY = Number((sourcePoint.y * scale).toFixed(2));
const cropX = `max(0,min(iw-iw/zoom,${targetX}-iw/zoom/2))`;
const cropY = `max(0,min(ih-ih/zoom,${targetY}-ih/zoom/2))`;
const filter = [
  `trim=start=${trimStart.toFixed(3)}:duration=${duration.toFixed(3)}`,
  'setpts=PTS-STARTPTS',
  'fps=30',
  'scale=1920:1200:flags=lanczos',
  `zoompan=z='${zoom}':x='${cropX}':y='${cropY}':d=1:s=1440x900:fps=30`,
  'settb=1/30',
  'setpts=N/(30*TB)',
  'format=yuv420p',
].join(',');

execFileSync('ffmpeg', [
  '-y', '-v', 'error', '-i', rawPath,
  '-vf', filter,
  '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', outputPath,
], { stdio: 'inherit' });

execFileSync('ffmpeg', [
  '-y', '-v', 'error', '-ss', String(Math.max(0, duration - 0.12)), '-i', outputPath,
  '-frames:v', '1', '-q:v', '2', '-update', '1', posterPath,
], { stdio: 'inherit' });

const selectedFrames = [
  0,
  frame(metadata.phaseMarks.inputEnd),
  frame(metadata.phaseMarks.focusEnd),
  frame((metadata.phaseMarks.focusEnd + metadata.phaseMarks.actionEnd) / 2),
  frame(metadata.phaseMarks.previewEnd),
  Math.max(0, frame(metadata.phaseMarks.resultEnd - 250)),
];
const select = selectedFrames.map(value => `eq(n\\,${value})`).join('+');
execFileSync('ffmpeg', [
  '-y', '-v', 'error', '-i', outputPath,
  '-vf', `select='${select}',scale=720:450:flags=lanczos,tile=3x2:padding=4:margin=4:color=0x171717`,
  '-frames:v', '1', '-q:v', '2', '-update', '1', contactPath,
], { stdio: 'inherit' });

const actual = JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,avg_frame_rate:format=duration', '-of', 'json', outputPath,
], { encoding: 'utf8' }));
console.log(JSON.stringify({ outputPath, posterPath, contactPath, trimStart, camera: scenario.camera, actual }, null, 2));

function frame(milliseconds) {
  return Math.round(milliseconds / 1000 * fps);
}

function progressExpression(start, end) {
  return `(on-${start})/${Math.max(1, end - start)}`;
}

function smoothstep(progress) {
  return `(${progress})*(${progress})*(3-2*(${progress}))`;
}
