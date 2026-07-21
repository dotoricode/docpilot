#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const configuredIdentity = packageJson.build?.mac?.identity;
const mode = process.env.DOCPILOT_DISTRIBUTION_MODE || (configuredIdentity === '-' ? 'unsigned' : 'notarized');
const hasSystemPolicyCheck = fs.existsSync('/usr/bin/syspolicy_check');

if (!['unsigned', 'notarized'].includes(mode)) {
  throw new Error(`Unsupported DOCPILOT_DISTRIBUTION_MODE: ${mode}`);
}

const apps = [
  { arch: 'x64', path: path.join(repoRoot, 'dist/package/mac/DocPilot.app') },
  { arch: 'arm64', path: path.join(repoRoot, 'dist/package/mac-arm64/DocPilot.app') },
];
const dmgs = [
  { arch: 'x64', path: path.join(repoRoot, `dist/package/DocPilot-${version}-x64.dmg`) },
  { arch: 'arm64', path: path.join(repoRoot, `dist/package/DocPilot-${version}-arm64.dmg`) },
];

function run(command, args, timeout = 180_000) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', timeout });
}

function output(result) {
  const processOutput = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const processError = result.error ? `${result.error.name}: ${result.error.message}` : '';
  return [processOutput, processError].filter(Boolean).join('\n');
}

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing release artifact: ${path.relative(repoRoot, filePath)}. Run npm run build first.`);
  }
}

function requireText(filePath, needles) {
  const body = fs.readFileSync(filePath, 'utf8');
  for (const needle of needles) {
    if (!body.includes(needle)) {
      throw new Error(`${path.relative(repoRoot, filePath)} must include the unsigned first-launch instruction: ${needle}`);
    }
  }
}

for (const artifact of [...apps, ...dmgs]) requireFile(artifact.path);

const report = [];
for (const app of apps) {
  const verify = run('codesign', ['--verify', '--deep', '--strict', app.path]);
  if (verify.status !== 0) throw new Error(`codesign verification failed for ${app.arch}: ${output(verify)}`);

  const details = output(run('codesign', ['--display', '--verbose=4', app.path]));
  // Apple's current distribution checker can take several minutes to inspect Electron's nested frameworks.
  // Older macOS versions fall back to the legacy Gatekeeper assessment CLI.
  const gatekeeper = hasSystemPolicyCheck
    ? run('/usr/bin/syspolicy_check', ['distribution', app.path], 300_000)
    : run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app.path], 300_000);
  const gatekeeperOutput = output(gatekeeper);

  if (mode === 'unsigned') {
    if (!details.includes('Signature=adhoc') || !details.includes('TeamIdentifier=not set')) {
      throw new Error(`${app.arch} must be explicitly ad-hoc signed in unsigned mode.`);
    }
    const expectedRejection = hasSystemPolicyCheck
      ? /failed one or more pre-distribution checks|Notary Ticket Missing/i.test(gatekeeperOutput)
      : /rejected/i.test(gatekeeperOutput);
    if (gatekeeper.status === 0 || !expectedRejection) {
      throw new Error(`${app.arch} unsigned app must reproduce Gatekeeper rejection; got: ${gatekeeperOutput}`);
    }
  } else {
    if (details.includes('Signature=adhoc') || !/Authority=Developer ID Application:/.test(details)) {
      throw new Error(`${app.arch} notarized release requires a Developer ID Application signature.`);
    }
    const expectedAcceptance = hasSystemPolicyCheck
      ? /passed all pre-distribution checks/i.test(gatekeeperOutput)
      : /accepted/i.test(gatekeeperOutput);
    if (gatekeeper.status !== 0 || !expectedAcceptance) {
      throw new Error(`${app.arch} notarized app failed Gatekeeper assessment: ${gatekeeperOutput}`);
    }
  }

  report.push(`${app.arch}: codesign valid; Gatekeeper ${gatekeeper.status === 0 ? 'accepted' : 'rejected'} (${mode})`);
}

for (const dmg of dmgs) {
  const stapler = output(run('xcrun', ['stapler', 'validate', dmg.path]));
  if (mode === 'unsigned' && !/does not have a ticket stapled/i.test(stapler)) {
    throw new Error(`${dmg.arch} unsigned DMG unexpectedly changed notarization state: ${stapler}`);
  }
  if (mode === 'notarized' && /does not have a ticket stapled/i.test(stapler)) {
    throw new Error(`${dmg.arch} notarized DMG has no stapled ticket: ${stapler}`);
  }
  report.push(`${dmg.arch} DMG: ${mode === 'unsigned' ? 'no notarization ticket (expected)' : 'notarization ticket present'}`);
}

if (mode === 'unsigned') {
  const requiredInstructions = ['시스템 설정', '개인정보 보호 및 보안', '확인 없이 열기'];
  requireText(path.join(repoRoot, 'docs/release-process.md'), requiredInstructions);
  requireText(path.join(repoRoot, 'prototypes/manual-v2/src/content.js'), requiredInstructions);
}

console.log(`macOS distribution gate passed in ${mode} mode`);
for (const line of report) console.log(`- ${line}`);
if (mode === 'unsigned') {
  console.log('- Fresh browser downloads WILL show a Gatekeeper warning; the manual override flow is mandatory.');
}
