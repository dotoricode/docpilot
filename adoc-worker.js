#!/usr/bin/env node
/**
 * adoc-worker.js — runs AsciiDoc conversion on a separate worker_threads
 * thread so bridge.js's main event loop (serving file/image requests,
 * the project watch poll, etc.) stays responsive while a large document
 * converts. See bridge.js's convertAsciidocInWorker() for the caller side.
 */
const { parentPort } = require('worker_threads');
const path = require('path');

// bridge.js and this worker are unpacked from app.asar for Electron's child
// process. Their normal Node resolution therefore cannot walk back into
// app.asar's node_modules. Load from the archive explicitly when packaged,
// while keeping ordinary `node` execution working in development.
function requireRuntimeDependency(name) {
  try {
    return require(name);
  } catch (error) {
    const resourcesPath = process.resourcesPath;
    if (!resourcesPath) throw error;
    return require(path.join(resourcesPath, 'app.asar', 'node_modules', name));
  }
}

const hljs = requireRuntimeDependency('highlight.js');

let asciidoctorProcessor = null;
function getAsciidoctor() {
  if (!asciidoctorProcessor) asciidoctorProcessor = requireRuntimeDependency('@asciidoctor/core')();
  return asciidoctorProcessor;
}

function unescapeHtml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// source-highlighter: 'highlightjs' makes Asciidoctor emit code blocks with
// highlight.js's expected classnames but leaves the actual highlighting to
// the client — normally a `<script>` on the page. Doing it here instead
// keeps the same "server produces final HTML" shape as the rest of this
// worker, and reuses the same highlight.js DocPilot already ships.
function highlightCodeBlocks(html) {
  return html.replace(
    /<pre class="highlightjs highlight"><code class="language-([\w-]+) hljs" data-lang="[\w-]+">([\s\S]*?)<\/code><\/pre>/g,
    (match, language, code) => {
      if (!hljs.getLanguage(language)) return match;
      try {
        const highlighted = hljs.highlight(unescapeHtml(code), { language, ignoreIllegals: true }).value;
        return `<pre class="highlightjs highlight"><code class="language-${language} hljs">${highlighted}</code></pre>`;
      } catch {
        return match;
      }
    },
  );
}

parentPort.on('message', ({ reqId, source }) => {
  try {
    const html = String(getAsciidoctor().convert(source, {
      safe: 'secure',
      standalone: false,
      attributes: { 'source-highlighter': 'highlightjs' },
    }));
    parentPort.postMessage({ reqId, html: highlightCodeBlocks(html) });
  } catch (err) {
    parentPort.postMessage({ reqId, error: err instanceof Error ? err.message : String(err) });
  }
});
