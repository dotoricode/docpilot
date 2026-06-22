#!/usr/bin/env node
/**
 * docs-bridge.js — eversafe_cordova docs editor bridge
 * Usage: node docs-bridge.js
 * Requires: claude CLI in PATH (Claude Code 설치되어 있으면 됩니다)
 */
const http  = require('http');
const { spawn } = require('child_process');

const PORT = 7474;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  // Health check
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // CC instruction execution
  if (req.method === 'POST' && req.url === '/instruct') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); }
      catch { res.writeHead(400, CORS); res.end(); return; }

      const { fileId, context, instruction, content } = payload;

      const prompt =
`You are editing a technical documentation file for a Cordova security SDK plugin.

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

      // 프롬프트를 env var로 전달 → ARG_MAX 우회 + stdin hanging 없음
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
    });
    return;
  }

  res.writeHead(404, CORS); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\ndocs-bridge  http://localhost:${PORT}`);
  console.log(`auth         claude CLI (no API key needed)\n`);
});
