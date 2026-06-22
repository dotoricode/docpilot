#!/usr/bin/env node
/**
 * bridge.js — docpilot bridge server
 * Usage: node bridge.js --root /path/to/docs
 * Requires: claude CLI in PATH (Claude Code 설치되어 있으면 됩니다)
 */
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

const PORT = 7474;

// --root 인자 파싱
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx !== -1 ? path.resolve(process.argv[rootIdx + 1]) : process.cwd();

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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /ping
  if (req.method === 'GET' && url.pathname === '/ping') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, root: ROOT }));
    return;
  }

  // GET /files — markdown 파일 트리 반환
  if (req.method === 'GET' && url.pathname === '/files') {
    try {
      const files = [];
      function walk(dir, rel) {
        for (const name of fs.readdirSync(dir).sort()) {
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

  // POST /instruct — claude 실행 후 SSE 스트리밍
  if (req.method === 'POST' && url.pathname === '/instruct') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400, CORS); res.end(); return; }

    const { fileId, context, instruction, content } = payload;

    const prompt =
`You are editing a documentation file.

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

    res.writeHead(200, {
      ...CORS,
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'X-Accel-Buffering': 'no',
    });

    const send = data => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    console.log(`[${new Date().toLocaleTimeString()}] ${fileId} — "${instruction.slice(0, 60)}"`);

    // claude를 직접 spawn — sh 경유 시 prompt 내 백틱이 command substitution으로 해석되는 버그 방지
    const proc = spawn('claude', ['-p', prompt], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let full = '';
    let killed = false;

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      full += text;
      send({ chunk: text });
    });

    proc.stderr.on('data', chunk => {
      process.stderr.write(chunk);
    });

    proc.on('close', (code, signal) => {
      if (killed) return;
      if (code === 0) {
        send({ done: true, proposed: full });
        console.log(`[${new Date().toLocaleTimeString()}] done (${full.split('\n').length} lines)`);
      } else {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        send({ error: `claude 실패 (${reason}). stderr 확인 필요.` });
      }
      try { res.end(); } catch {}
    });

    proc.on('error', err => {
      send({ error: `claude를 실행할 수 없습니다: ${err.message}\n\nclaude CLI가 PATH에 있는지 확인하세요.` });
      try { res.end(); } catch {}
    });

    // 90초 타임아웃
    const timer = setTimeout(() => {
      if (!killed) { killed = true; proc.kill(); send({ error: '타임아웃 (90s) — claude가 응답하지 않습니다' }); try { res.end(); } catch {} }
    }, 90000);
    proc.on('close', () => clearTimeout(timer));

    // req.on('close')는 body 전송 직후 오인 트리거되므로 res.on('close') 사용
    res.on('close', () => { if (!killed) { killed = true; clearTimeout(timer); try { proc.kill(); } catch {} } });
    return;
  }

  res.writeHead(404, CORS); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\ndocpilot bridge  http://localhost:${PORT}`);
  console.log(`root             ${ROOT}\n`);
});
