#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scriptsDir = __dirname;
const repoRoot = path.resolve(scriptsDir, '..');
const discoveredChecks = fs.readdirSync(scriptsDir)
  .filter(name => /^check-react-.*\.js$/.test(name))
  .sort();
const requestedChecks = process.argv.slice(2);
const checks = requestedChecks.length
  ? discoveredChecks.filter(name => requestedChecks.includes(name))
  : discoveredChecks;
const quarantinedChecks = new Map([
  ['check-react-agent-streaming.js', 'legacy AgentPanel is not mounted in the current workbench'],
  ['check-react-context-diff-acceptance.js', 'legacy context workflow depends on the unmounted AgentPanel composer'],
  ['check-react-issue-acceptance.js', 'legacy acceptance flow depends on the unmounted AgentPanel composer'],
]);

if (!checks.length || requestedChecks.some(name => !discoveredChecks.includes(name))) {
  console.error(`No matching React regression checks were found: ${requestedChecks.join(', ') || '(all)'}`);
  process.exit(1);
}

let executed = 0;
let quarantined = 0;
for (const [index, check] of checks.entries()) {
  const quarantineReason = quarantinedChecks.get(check);
  if (quarantineReason) {
    console.log(`[quiet-regression ${index + 1}/${checks.length}] SKIP ${check} — ${quarantineReason}`);
    quarantined += 1;
    continue;
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-quiet-regression-'));
  console.log(`[quiet-regression ${index + 1}/${checks.length}] ${check}`);
  try {
    const result = spawnSync(process.execPath, [path.join(scriptsDir, check)], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DOCPILOT_TEST_HIDDEN_WINDOWS: '1',
        DOCPILOT_USER_DATA_DIR: userData,
      },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
    executed += 1;
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

console.log(`quiet React regression suite passed (${executed} executed, ${quarantined} quarantined)`);
