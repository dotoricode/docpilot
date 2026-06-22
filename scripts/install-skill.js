#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const help = args.has('--help') || args.has('-h');

if (help) {
  console.log(`Usage: node scripts/install-skill.js [--dry-run]

Installs the docpilot Claude Code skill to:
  ~/.claude/skills/docpilot/SKILL.md
`);
  process.exit(0);
}

const projectDir = path.resolve(__dirname, '..');
const sourceSkill = path.join(projectDir, 'SKILL.md');
const targetDir = path.join(os.homedir(), '.claude', 'skills', 'docpilot');
const targetSkill = path.join(targetDir, 'SKILL.md');

if (!fs.existsSync(sourceSkill)) {
  console.error(`SKILL.md not found: ${sourceSkill}`);
  process.exit(1);
}

let content = fs.readFileSync(sourceSkill, 'utf8');
content = content.split('__DOCPILOT_DIR__').join(projectDir);

console.log('docpilot skill install');
console.log(`  source : ${sourceSkill}`);
console.log(`  target : ${targetSkill}`);
console.log(`  project: ${projectDir}`);

if (dryRun) {
  console.log('dry run: no files written');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(targetSkill, content, 'utf8');

console.log('\nInstalled.');
console.log('Restart Claude Code if it is already running, then use:');
console.log('  /docpilot [/path/to/docs]');
