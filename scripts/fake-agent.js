#!/usr/bin/env node

const requestedRuntime = process.argv[2];
const agent = requestedRuntime === 'codex' || requestedRuntime === 'shell' ? requestedRuntime : 'claude';
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

function writeChunked(text) {
  const delayMs = Math.max(0, Number(process.env.DOCPILOT_FAKE_AGENT_DELAY_MS || 0));
  const chunkSize = Math.max(1, Number(process.env.DOCPILOT_FAKE_AGENT_CHUNK_SIZE || 0));
  if (!delayMs || !chunkSize || text.length <= chunkSize) {
    process.stdout.write(text);
    return;
  }
  let offset = 0;
  const writeNext = () => {
    if (offset >= text.length) return;
    process.stdout.write(text.slice(offset, offset + chunkSize));
    offset += chunkSize;
    if (offset < text.length) setTimeout(writeNext, delayMs);
  };
  writeNext();
}

function writeLines(lines) {
  const delayMs = Math.max(0, Number(process.env.DOCPILOT_FAKE_AGENT_DELAY_MS || 0));
  if (!delayMs) {
    for (const line of lines) process.stdout.write(line);
    return;
  }
  let index = 0;
  const writeNext = () => {
    if (index >= lines.length) return;
    process.stdout.write(lines[index]);
    index += 1;
    if (index < lines.length) setTimeout(writeNext, delayMs);
  };
  writeNext();
}

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
    writeChunked(`${JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: `fake codex response: ${summary}${artifactText}`,
      },
    })}\n`);
  } else {
    const text = `fake claude response: ${summary}${artifactText}\n`;
    const chunks = ['fake claude ', 'response: ', `${summary}${artifactText}\n`];
    writeLines([
      `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' })}\n`,
      ...chunks.map(chunk => `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: chunk },
        },
      })}\n`),
      `${JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text }] },
      })}\n`,
      `${JSON.stringify({ type: 'result', subtype: 'success', result: text })}\n`,
    ]);
  }
});
