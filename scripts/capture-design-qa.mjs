import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [
  socketUrl,
  outputPath,
  theme = 'dark',
  filePath = 'docs/architecture/orca-parity-redesign.md',
  captureMode = 'preview',
] = process.argv.slice(2);
if (!socketUrl || !outputPath) {
  throw new Error('Usage: node scripts/capture-design-qa.mjs <websocket-url> <output.png> [dark|light]');
}

const socket = new WebSocket(socketUrl);
let requestId = 0;
const pending = new Map();

function call(method, params = {}) {
  const id = ++requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

await call('Page.enable');
await call('Runtime.enable');
await call('Network.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });
if (captureMode === 'page') {
  await call('Emulation.setDeviceMetricsOverride', {
    width: 2880,
    height: 1120,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call('Page.navigate', { url: filePath });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const pageResult = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(pageResult.data, 'base64'));
  socket.close();
  process.exit(0);
}
await call('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1024,
  deviceScaleFactor: 1,
  mobile: false,
});
const themeResult = await call('Runtime.evaluate', {
  expression: `(() => {
    localStorage.setItem('docpilot:left-panel-width', '274');
    localStorage.setItem('docpilot:terminal-orientation', 'vertical');
    localStorage.removeItem('docpilot:workbench-pane-layout');
    localStorage.setItem('docpilot:terminal-size', '260');
    location.reload();
  })()`,
});
await new Promise(resolve => setTimeout(resolve, 1200));
await call('Runtime.evaluate', {
  expression: `(() => {
    const button = [...document.querySelectorAll('.theme-toggle button')]
      .find(item => item.textContent?.trim().toLowerCase() === '${theme}');
    if (button && !button.classList.contains('active')) button.click();
    return document.documentElement.dataset.theme;
  })()`,
  awaitPromise: true,
});
await new Promise(resolve => setTimeout(resolve, 300));
await call('Runtime.evaluate', {
  expression: `(() => {
    const segments = ${JSON.stringify(filePath)}.split('/').slice(0, -1);
    let current = '';
    for (const segment of segments) {
      current = current ? current + '/' + segment : segment;
      const folder = [...document.querySelectorAll('.workspace-folder-row')]
        .find(item => item.getAttribute('title') === current);
      if (folder && !folder.classList.contains('expanded')) folder.click();
    }
  })()`,
  awaitPromise: true,
});
await new Promise(resolve => setTimeout(resolve, 300));
await call('Runtime.evaluate', {
  expression: `(() => {
    const file = [...document.querySelectorAll('.workspace-file-row')]
      .find(item => item.getAttribute('title') === ${JSON.stringify(filePath)});
    if (file) file.click();
    return Boolean(file);
  })()`,
  awaitPromise: true,
});
await new Promise(resolve => setTimeout(resolve, 800));
if (captureMode === 'diff') {
  await call('Runtime.evaluate', {
    expression: `(() => {
      [...document.querySelectorAll('.editor-mode-toggle button')]
        .find(item => item.textContent?.trim() === 'Source')?.click();
    })()`,
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  await call('Runtime.evaluate', {
    expression: `document.querySelector('.cm-content')?.focus()`,
  });
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', modifiers: 4 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', modifiers: 4 });
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End' });
  await call('Input.insertText', { text: '\nDesign QA change.' });
  await new Promise(resolve => setTimeout(resolve, 300));
  await call('Runtime.evaluate', {
    expression: `(() => {
      [...document.querySelectorAll('.editor-mode-toggle button')]
        .find(item => item.textContent?.trim() === 'Preview')?.click();
    })()`,
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  await call('Runtime.evaluate', {
    expression: `document.querySelector('.diff-toggle input')?.click()`,
  });
  await new Promise(resolve => setTimeout(resolve, 700));
  await call('Runtime.evaluate', {
    expression: `document.querySelector('.diff-change-list button')?.click()`,
  });
  await new Promise(resolve => setTimeout(resolve, 500));
}
const state = await call('Runtime.evaluate', {
  expression: `({
    theme: document.documentElement.dataset.theme,
    topbar: document.querySelector('.app-topbar')?.textContent?.trim(),
    terminalBackground: getComputedStyle(document.querySelector('.terminal-xterm-host') || document.body).backgroundColor,
    changes: document.querySelectorAll('.diff-change-list button').length,
    diffBlock: (() => {
      const block = document.querySelector('.preview-diff-block.add, .preview-diff-block.change-new');
      if (!block) return null;
      const rect = block.getBoundingClientRect();
      const scroller = block.closest('.markdown-preview');
      const style = getComputedStyle(block);
      const hit = document.elementFromPoint(rect.left + Math.min(120, rect.width / 2), rect.top + rect.height / 2);
      return {
        text: block.textContent,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        scrollerTop: scroller?.getBoundingClientRect().top,
        scrollTop: scroller?.scrollTop,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        background: style.backgroundColor,
        color: style.color,
        hitClass: hit?.className,
      };
    })(),
    diffIndexed: [...document.querySelectorAll('[data-diff-index]')].slice(0, 4).map(block => ({
      className: block.className,
      text: block.textContent,
    })),
    diffPage: (() => {
      const page = document.querySelector('.preview-diff-page');
      if (!page) return null;
      const style = getComputedStyle(page);
      return { display: style.display, gridTemplateRows: style.gridTemplateRows, height: page.getBoundingClientRect().height };
    })(),
  })`,
  returnByValue: true,
});
if (state.result?.value?.theme !== theme) {
  throw new Error(`Theme toggle failed: expected ${theme}, received ${state.result?.value?.theme || 'unknown'}`);
}
console.log(JSON.stringify({ requestedTheme: theme, toggle: themeResult.result?.value, ...state.result.value }));
await new Promise(resolve => setTimeout(resolve, 1000));
const result = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.from(result.data, 'base64'));
socket.close();
