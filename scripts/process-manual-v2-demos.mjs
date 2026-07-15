import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'prototypes/manual-v2/content/demo-motion-spec.json'), 'utf8'));
const sourceRoot = path.join(repoRoot, '.tink', 'current', 'artifacts', 'demo-raw');
const reviewRoot = path.join(repoRoot, '.tink', 'current', 'artifacts', 'demo-processed');
const outputRoot = path.join(repoRoot, 'prototypes', 'manual-v2', 'public', 'media', 'demos');
const metadataPath = path.join(repoRoot, 'prototypes', 'manual-v2', 'content', 'demo-metadata.json');
const requestedScenario = process.argv[2] || 'all';
const scenarioNames = Object.keys(spec.productionScenarios);
const report = [];

fs.mkdirSync(outputRoot, { recursive: true });
fs.mkdirSync(reviewRoot, { recursive: true });

for (const name of scenarioNames) {
  if (requestedScenario !== 'all' && requestedScenario !== name) continue;
  const source = path.join(sourceRoot, `${name}.webm`);
  const captureMetadata = path.join(sourceRoot, `${name}.json`);
  if (!fs.existsSync(source) || !fs.existsSync(captureMetadata)) {
    throw new Error(`Missing captured demo source for ${name}`);
  }

  const metadata = JSON.parse(fs.readFileSync(captureMetadata, 'utf8'));
  const rawDuration = durationOf(source);
  const duration = metadata.measuredScenarioDurationMs / 1000;
  const trimStart = Math.max(0, rawDuration - duration - metadata.postScenarioHoldMs / 1000);
  const fps = spec.capture.fps;
  const focusStartFrame = frame(metadata.phaseMarks.inputEnd, fps);
  const focusEndFrame = frame(metadata.phaseMarks.inputEnd + metadata.camera.transitionMs, fps);
  const overviewStartFrame = frame(metadata.camera.overviewStartMs, fps);
  const overviewEndFrame = frame(metadata.camera.overviewStartMs + metadata.camera.transitionMs, fps);
  const zoomDelta = metadata.camera.focusScale - 1;
  const focusProgress = progressExpression(focusStartFrame, focusEndFrame);
  const overviewProgress = progressExpression(overviewStartFrame, overviewEndFrame);
  const zoom = [
    `if(lt(on,${focusStartFrame}),1`,
    `if(lt(on,${focusEndFrame}),1+${zoomDelta}*${smoothstep(focusProgress)}`,
    `if(lt(on,${overviewStartFrame}),${metadata.camera.focusScale}`,
    `if(lt(on,${overviewEndFrame}),${metadata.camera.focusScale}-${zoomDelta}*${smoothstep(overviewProgress)},1))))`,
  ].join(',');
  const targetX = Number((metadata.camera.focusPoint.x * 4 / 3).toFixed(2));
  const targetY = Number((metadata.camera.focusPoint.y * 4 / 3).toFixed(2));
  const cropX = `max(0,min(iw-iw/zoom,${targetX}-iw/zoom/2))`;
  const cropY = `max(0,min(ih-ih/zoom,${targetY}-ih/zoom/2))`;
  const filter = [
    `trim=start=${trimStart.toFixed(3)}:duration=${duration.toFixed(3)}`,
    'setpts=PTS-STARTPTS',
    `fps=${fps}`,
    'scale=1920:1200:flags=lanczos',
    `zoompan=z='${zoom}':x='${cropX}':y='${cropY}':d=1:s=1440x900:fps=${fps}`,
    `settb=1/${fps}`,
    `setpts=N/(${fps}*TB)`,
    'format=yuv420p',
  ].join(',');

  const master = path.join(outputRoot, `${name}.mp4`);
  const webm = path.join(outputRoot, `${name}.webm`);
  const gif = path.join(outputRoot, `${name}.gif`);
  const poster = path.join(outputRoot, `${name}.jpg`);
  const contact = path.join(reviewRoot, `${name}-contact.jpg`);

  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', source, '-vf', filter,
    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', master,
  ], { stdio: 'inherit' });
  const actualDuration = durationOf(master);
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', master, '-vf', 'scale=960:-2:flags=lanczos',
    '-an', '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', webm,
  ], { stdio: 'inherit' });
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', master,
    '-filter_complex', '[0:v]fps=12,scale=800:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5',
    '-loop', '0', gif,
  ], { stdio: 'inherit' });
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-ss', String(Math.max(0, actualDuration - 0.12)), '-i', master,
    '-frames:v', '1', '-q:v', '2', '-update', '1', poster,
  ], { stdio: 'inherit' });

  const selectedFrames = [0, 0.2, 0.4, 0.6, 0.8, 0.98].map(progress => Math.max(0, Math.round(actualDuration * fps * progress)));
  const select = selectedFrames.map(value => `eq(n\\,${value})`).join('+');
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', master,
    '-vf', `select='${select}',scale=720:450:flags=lanczos,tile=3x2:padding=4:margin=4:color=0x171717`,
    '-frames:v', '1', '-q:v', '2', '-update', '1', contact,
  ], { stdio: 'inherit' });

  const probe = probeVideo(master);
  const entry = {
    name,
    durationSeconds: Number(actualDuration.toFixed(2)),
    fps: rate(probe.streams[0].avg_frame_rate),
    masterBytes: fs.statSync(master).size,
    webBytes: fs.statSync(webm).size,
    phases: Object.keys(metadata.phaseMarks),
    goal: metadata.contract.goal,
    outcome: metadata.contract.outcome,
    contactSheet: path.relative(repoRoot, contact),
  };
  report.push(entry);
  console.log(JSON.stringify(entry));
}

if (requestedScenario === 'all') {
  fs.writeFileSync(metadataPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'Playwright Electron recording with phase metadata and continuous FFmpeg camera motion',
    viewport: `${spec.capture.viewport.width}x${spec.capture.viewport.height}`,
    demos: report,
  }, null, 2)}\n`);
}

function durationOf(file) {
  return Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ], { encoding: 'utf8' }).trim());
}

function probeVideo(file) {
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate:format=duration', '-of', 'json', file,
  ], { encoding: 'utf8' }));
}

function frame(milliseconds, fps) {
  return Math.round(milliseconds / 1000 * fps);
}

function progressExpression(start, end) {
  return `(on-${start})/${Math.max(1, end - start)}`;
}

function smoothstep(progress) {
  return `(${progress})*(${progress})*(3-2*(${progress}))`;
}

function rate(value = '0/1') {
  const [numerator, denominator] = String(value).split('/').map(Number);
  return denominator ? numerator / denominator : 0;
}
