#!/usr/bin/env node

const agent = process.argv[2] === 'codex' ? 'codex' : 'claude';
const interactive = process.argv.includes('--interactive');

if (interactive) {
  process.stdout.write(`fake ${agent} interactive ready\n`);
  process.stdin.setEncoding('utf8');
  let line = '';
  process.stdin.on('data', chunk => {
    for (const char of chunk) {
      if (char === '\u0003') process.exit(130);
      if (char === '\r' || char === '\n') {
        const text = line.trim();
        process.stdout.write(text ? `fake ${agent}> ${text}\n` : `fake ${agent}> \n`);
        line = '';
      } else {
        line += char;
      }
    }
  });
  return;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
});
process.stdin.on('end', () => {
  const summary = input.replace(/\s+/g, ' ').trim().slice(0, 80) || '(empty prompt)';
  const writeFile = process.env.DOCPILOT_FAKE_AGENT_WRITE_FILE;
  const artifactFile = process.env.DOCPILOT_FAKE_AGENT_ARTIFACT_FILE;
  if (writeFile) {
    require('fs').writeFileSync(writeFile, `# Fake Agent Change\n\n${summary}\n`, 'utf8');
  }
  const artifactText = artifactFile
    ? `\n<docpilot-artifact kind="patch" file="${artifactFile}">\n# Fake Artifact\n\n${summary}\n</docpilot-artifact>\n`
    : '';
  if (agent === 'codex') {
    process.stdout.write(`${JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: `fake codex response: ${summary}${artifactText}`,
      },
    })}\n`);
  } else {
    process.stdout.write(`fake claude response: ${summary}${artifactText}\n`);
  }
});
