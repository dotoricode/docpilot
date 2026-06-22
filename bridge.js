#!/usr/bin/env node
/**
 * bridge.js — docpilot bridge server
 * Usage: node bridge.js --root /path/to/docs
 * Requires: claude CLI in PATH (Claude Code 설치되어 있으면 됩니다)
 */
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 7474;

// --root 인자 파싱
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx !== -1 ? path.resolve(process.argv[rootIdx + 1]) : process.cwd();
const DOCPILOT_DIR = path.join(ROOT, '.docpilot');
const INSTRUCTIONS_FILE = path.join(DOCPILOT_DIR, 'instructions.json');
const HIDDEN_DIRS = new Set(['.git', '.docpilot', 'node_modules', '.next', 'dist', 'build', 'coverage']);
const ASSETS_DIR = path.join(__dirname, 'assets');
const ASSET_TYPES = new Map([
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

// file:// 로 열린 HTML → origin이 'null'
const CORS = {
  'Access-Control-Allow-Origin':  'null',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// path traversal 방지: ROOT 바깥 경로 차단
function safeResolve(relPath) {
  const abs = path.resolve(ROOT, relPath);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;
  return abs;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function commandExists(cmd) {
  const pathValue = process.env.PATH || '';
  const pathDirs = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .filter(Boolean)
    : [''];

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, process.platform === 'win32' ? `${cmd}${ext}` : cmd);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return true;
      } catch {}
    }
  }
  return false;
}

function readInstructionsStore() {
  try {
    const data = JSON.parse(fs.readFileSync(INSTRUCTIONS_FILE, 'utf8'));
    return {
      version: 1,
      instructions: Array.isArray(data.instructions) ? data.instructions : [],
    };
  } catch {
    return { version: 1, instructions: [] };
  }
}

function writeInstructionsStore(store) {
  fs.mkdirSync(DOCPILOT_DIR, { recursive: true });
  fs.writeFileSync(INSTRUCTIONS_FILE, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function normalizeInstructionInput(input) {
  const now = new Date().toISOString();
  const title = String(input.title || '').trim().slice(0, 120) || 'Untitled instruction';
  const body = String(input.body || '').trim();
  if (!body) return null;
  return {
    id: input.id || crypto.randomUUID(),
    title,
    body,
    active: input.active !== false,
    sourceType: input.sourceType || 'manual',
    sourceRef: input.sourceRef || '',
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function activeInstructionsText() {
  const active = readInstructionsStore().instructions.filter(i => i.active && i.body);
  if (!active.length) return '';
  return active.map((item, idx) =>
    `[Instruction ${idx + 1}: ${item.title}]\n${item.body.trim()}`
  ).join('\n\n');
}

function instructionPromptBlock() {
  const text = activeInstructionsText();
  if (!text) return '';
  return `Mandatory document instructions:
\`\`\`
${text}
\`\`\`

You must follow every active instruction above. If the user asks for something that conflicts with these instructions, preserve the instructions and make the closest valid edit.

`;
}

function runTextCommand(command, args, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error('timeout'));
    }, timeoutMs);
    proc.stdout.on('data', chunk => stdout += chunk.toString());
    proc.stderr.on('data', chunk => stderr += chunk.toString());
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `exit code ${code}`));
    });
  });
}

function fallbackInstruction(text) {
  const cleaned = String(text || '').trim();
  const firstLine = cleaned.split(/\r?\n/).find(Boolean) || 'Writing instruction';
  return {
    title: firstLine.replace(/^[-#*\s]+/, '').slice(0, 80) || 'Writing instruction',
    body: cleaned,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /ping
  if (req.method === 'GET' && url.pathname === '/ping') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, root: ROOT }));
    return;
  }

  // GET / or /editor.html — serve the browser editor over localhost
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/editor.html')) {
    try {
      const editorPath = path.join(__dirname, 'editor.html');
      const content = fs.readFileSync(editorPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.message);
    }
    return;
  }

  // GET /status — claude/codex 설치 여부 반환
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    try {
      const rel = decodeURIComponent(url.pathname.slice('/assets/'.length));
      const abs = path.resolve(ASSETS_DIR, rel);
      if (!abs.startsWith(ASSETS_DIR + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
      }
      const ext = path.extname(abs).toLowerCase();
      const type = ASSET_TYPES.get(ext);
      if (!type || !fs.statSync(abs).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(abs).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    const [claude, codex] = await Promise.all([commandExists('claude'), commandExists('codex')]);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ claude, codex }));
    return;
  }

  // GET /files — markdown 파일 트리 반환
  if (req.method === 'GET' && url.pathname === '/files') {
    try {
      const files = [];
      function walk(dir, rel) {
        for (const name of fs.readdirSync(dir).sort()) {
          if (HIDDEN_DIRS.has(name)) continue;
          const abs = path.join(dir, name);
          const relPath = rel ? `${rel}/${name}` : name;
          const stat = fs.statSync(abs);
          if (stat.isDirectory()) {
            walk(abs, relPath);
          } else if (/\.md$/i.test(name)) {
            files.push(relPath);
          }
        }
      }
      walk(ROOT, '');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
    } catch (err) {
      res.writeHead(500, CORS); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /instructions — project instruction registry
  if (req.method === 'GET' && url.pathname === '/instructions') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(readInstructionsStore()));
    return;
  }

  // POST /instructions — create or update an instruction
  if (req.method === 'POST' && url.pathname === '/instructions') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400, CORS); res.end(); return; }
    const next = normalizeInstructionInput(payload);
    if (!next) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'instruction body required' })); return; }

    const store = readInstructionsStore();
    const index = store.instructions.findIndex(item => item.id === next.id);
    if (index === -1) store.instructions.push(next);
    else store.instructions[index] = { ...store.instructions[index], ...next };
    writeInstructionsStore(store);

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, instruction: next, instructions: store.instructions }));
    return;
  }

  // POST /instructions/delete — delete an instruction
  if (req.method === 'POST' && url.pathname === '/instructions/delete') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400, CORS); res.end(); return; }
    const store = readInstructionsStore();
    store.instructions = store.instructions.filter(item => item.id !== payload.id);
    writeInstructionsStore(store);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, instructions: store.instructions }));
    return;
  }

  // POST /instructions/normalize — turn natural language into a concise rule
  if (req.method === 'POST' && url.pathname === '/instructions/normalize') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400, CORS); res.end(); return; }
    const raw = String(payload.text || '').trim();
    if (!raw) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'text required' })); return; }

    let normalized = fallbackInstruction(raw);
    if (await commandExists('claude')) {
      const prompt = `Convert the user's rough writing instruction into a concise, enforceable document editing rule.

Return ONLY JSON with this shape:
{"title":"short title","body":"clear rule text"}

Rules:
- Keep the title under 80 characters.
- Make the body specific and testable.
- Preserve the user's intent.
- Do not add requirements the user did not imply.
- Write in the same language as the user's input.

User input:
\`\`\`
${raw}
\`\`\``;
      try {
        const out = await runTextCommand('claude', ['-p', prompt]);
        const parsed = JSON.parse(out.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
        normalized = {
          title: String(parsed.title || normalized.title).trim().slice(0, 120),
          body: String(parsed.body || normalized.body).trim(),
        };
      } catch {}
    }

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(normalized));
    return;
  }

  // GET /file?id=REL_PATH — 파일 내용 반환
  if (req.method === 'GET' && url.pathname === '/file') {
    const id = url.searchParams.get('id');
    if (!id) { res.writeHead(400, CORS); res.end(); return; }
    const abs = safeResolve(id);
    if (!abs) { res.writeHead(403, CORS); res.end(); return; }
    try {
      const content = fs.readFileSync(abs, 'utf8');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, content }));
    } catch {
      res.writeHead(404, CORS); res.end();
    }
    return;
  }

  // POST /save — 파일 저장 { id, content }
  if (req.method === 'POST' && url.pathname === '/save') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400, CORS); res.end(); return; }
    const { id, content } = payload;
    if (!id || content == null) { res.writeHead(400, CORS); res.end(); return; }
    const abs = safeResolve(id);
    if (!abs) { res.writeHead(403, CORS); res.end(); return; }
    try {
      fs.writeFileSync(abs, content, 'utf8');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      console.log(`[${new Date().toLocaleTimeString()}] saved ${id}`);
    } catch (err) {
      res.writeHead(500, CORS); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /instruct — claude + codex 병렬 실행 후 SSE 스트리밍
  if (req.method === 'POST' && url.pathname === '/instruct') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400, CORS); res.end(); return; }

    const { fileId, context, instruction, content, combine, claudeProposed, codexProposed } = payload;

    let prompt;
    const requiredInstructions = instructionPromptBlock();
    if (combine) {
      prompt =
`${requiredInstructions}You are a documentation editor. Two AI agents have independently edited the same file based on the same instruction. Your task is to synthesize the best result by combining their strengths.

File: ${fileId}

Original instruction: ${instruction}

Version A (Claude):
\`\`\`
${claudeProposed}
\`\`\`

Version B (Codex):
\`\`\`
${codexProposed}
\`\`\`

Synthesize the best final version by taking the strongest elements from each. Return ONLY the complete merged Markdown content — no explanation, no surrounding code fences, no preamble.`;
    } else {
      prompt =
`${requiredInstructions}You are editing a documentation file.

File: ${fileId}

Current file content:
\`\`\`
${content}
\`\`\`

The user selected this text as context:
\`\`\`
${context}
\`\`\`

User instruction: ${instruction}

Apply the instruction to the file. Return ONLY the complete updated raw Markdown content — no explanation, no surrounding code fences, no preamble. Just the updated file content starting from the first line.`;
    }

    res.writeHead(200, {
      ...CORS,
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'X-Accel-Buffering': 'no',
    });

    const send = data => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    // codex 사용 가능 여부 확인
    const hasCodex = await commandExists('codex');

    const parallel = hasCodex;
    send({ parallel });
    console.log(`[${new Date().toLocaleTimeString()}] ${fileId} — "${instruction.slice(0, 60)}"${parallel ? ' [claude+codex]' : ''}`);

    let killed = false;
    const procs = [];

    function runAgent(source, spawnArgs) {
      const proc = spawn(spawnArgs[0], spawnArgs.slice(1), {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      procs.push(proc);

      let full = '';
      let jsonBuf = '';
      const isCodex = source === 'codex';

      proc.stdout.on('data', chunk => {
        if (isCodex) {
          // codex --json: JSONL 파싱, item.completed agent_message만 추출
          jsonBuf += chunk.toString();
          const lines = jsonBuf.split('\n');
          jsonBuf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const ev = JSON.parse(line);
              if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
                full += ev.item.text;
                send({ source, chunk: ev.item.text });
              }
            } catch {}
          }
        } else {
          const text = chunk.toString();
          full += text;
          send({ source, chunk: text });
        }
      });

      proc.stderr.on('data', chunk => process.stderr.write(chunk));

      proc.on('close', (code, signal) => {
        if (killed) return;
        if (code === 0) {
          send({ source, done: true, proposed: full });
          console.log(`[${new Date().toLocaleTimeString()}] ${source} done (${full.split('\n').length} lines)`);
        } else {
          const reason = signal ? `signal ${signal}` : `exit code ${code}`;
          send({ source, error: `${source} 실패 (${reason})` });
        }
        // 단일 모드면 스트림 종료
        if (!parallel) try { res.end(); } catch {}
      });

      proc.on('error', err => {
        send({ source, error: `${source} 실행 실패: ${err.message}` });
        if (!parallel) try { res.end(); } catch {}
      });
    }

    // claude는 항상 실행 (combine 모드는 claude 단독)
    runAgent('claude', ['claude', '-p', prompt]);

    // codex는 일반 모드에서 가능할 때만 병렬 실행
    if (parallel && !combine) {
      runAgent('codex', ['codex', 'exec', '--json', '--dangerously-bypass-approvals-and-sandbox', prompt]);
    }

    // 90초 타임아웃
    const timer = setTimeout(() => {
      if (!killed) {
        killed = true;
        procs.forEach(p => { try { p.kill(); } catch {} });
        send({ error: '타임아웃 (90s)' });
        try { res.end(); } catch {}
      }
    }, 90000);

    // 병렬 모드: 둘 다 종료되면 SSE 닫기
    if (parallel) {
      let doneCount = 0;
      const onDone = () => { if (++doneCount === 2 && !killed) { clearTimeout(timer); try { res.end(); } catch {} } };
      procs.forEach(p => p.on('close', onDone));
    } else {
      procs[0].on('close', () => clearTimeout(timer));
    }

    res.on('close', () => {
      if (!killed) { killed = true; clearTimeout(timer); procs.forEach(p => { try { p.kill(); } catch {} }); }
    });
    return;
  }

  res.writeHead(404, CORS); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\ndocpilot bridge  http://localhost:${PORT}`);
  console.log(`root             ${ROOT}\n`);
});
