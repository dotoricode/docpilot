const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function waitForReactEditorWindow(app) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    for (const win of app.windows()) {
      const url = win.url();
      if (url.includes('dist/renderer/index.html') || url.endsWith('/index.html')) return win;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor window did not open. Windows: ${app.windows().map(win => win.url()).join(', ')}`);
}

function rgbValue(channelText) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(channelText || '');
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const executablePath = process.env.DOCPILOT_ELECTRON_EXECUTABLE || '';
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-highlight-yaml-'));
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), [
    '# Highlight Fixture',
    '',
    'appserver is the application API server and builds reminder URLs for Contacts import.',
    '',
    '```js',
    'const reminderUrl = contacts.map(item => item.url);',
    'function createReminder(input) {',
    '  return { enabled: true, input };',
    '}',
    '```',
    '',
    '```yaml',
    'service: appserver',
    'reminderUrl: true',
    '```',
    '',
    '```bash',
    'cd /Users/isang-won/AndroidStudioProjects/phishing-block/components/appserver',
    '',
    './mvnw spring-boot:run \\',
    '  -Pdev \\',
    '  -Dspring-boot.run.arguments="--spring.cloud.aws.secretsmanager.enabled=false --spring.config.import=optional:configtree:/run/secrets/"',
    '```',
    '',
    '```',
    'SELECT id, reminder_url FROM contacts WHERE enabled = true;',
    '```',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'config.yaml'), 'service: appserver\nreminderUrl: true\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'values.yml'), 'enabled: true\n', 'utf8');

  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ['.'] }),
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_FAKE_AGENT: '1',
    },
  });

  try {
    const start = await app.firstWindow();
    await start.waitForLoadState('domcontentloaded');
    await start.evaluate(root => {
      window.docpilot.openFolder(root);
      return true;
    }, fixtureRoot);

    const editor = await waitForReactEditorWindow(app);
    await editor.waitForSelector('.workspace-sidebar');
    await editor.waitForSelector('.workspace-file-row');

    const fileNames = await editor.locator('.workspace-file-row .tree-name').allInnerTexts();
    for (const expected of ['README.md', 'config.yaml', 'values.yml']) {
      if (!fileNames.includes(expected)) {
        throw new Error(`workspace tree should include ${expected}, got: ${fileNames.join(', ')}`);
      }
    }

    await editor.locator('.workspace-file-row').filter({ hasText: 'README.md' }).first().click();
    await editor.waitForSelector('.markdown-preview pre code.hljs');
    await editor.waitForSelector('.markdown-preview pre[data-line-start][data-line-end][data-line-label]');
    await editor.waitForFunction(() => document.querySelector('.markdown-preview h1')?.getAttribute('data-line-label') === '1');

    const bodyShape = await editor.locator('.preview-shell').first().evaluate(shell => {
      const preview = shell.querySelector('.markdown-preview');
      const paragraph = shell.querySelector('.markdown-preview p');
      const heading = shell.querySelector('.markdown-preview h1');
      const toc = shell.querySelector('.toc-rail');
      const shellRect = shell.getBoundingClientRect();
      const previewRect = preview ? preview.getBoundingClientRect() : null;
      const tocRect = toc ? toc.getBoundingClientRect() : null;
      const headingRect = heading ? heading.getBoundingClientRect() : null;
      const headingLineStyle = heading ? getComputedStyle(heading, '::before') : null;
      const headingLineLeft = headingRect && headingLineStyle
        ? headingRect.left - shellRect.left + Number.parseFloat(headingLineStyle.left || '0')
        : -1;
      const headingLineWidth = headingLineStyle ? Number.parseFloat(headingLineStyle.width || '0') : 0;
      const headingLineRight = headingLineLeft + headingLineWidth;
      const previewLeft = previewRect ? previewRect.left - shellRect.left : -1;
      return {
        shellBackground: getComputedStyle(shell).backgroundColor,
        shellColumns: getComputedStyle(shell).gridTemplateColumns,
        shellGutterContent: getComputedStyle(shell, '::before').content || '',
        shellGutterBackground: getComputedStyle(shell, '::before').backgroundColor || '',
        tocBackground: toc ? getComputedStyle(toc).backgroundColor : '',
        previewLeft,
        tocLeft: tocRect ? tocRect.left - shellRect.left : -1,
        previewRight: previewRect ? previewRect.right - shellRect.left : -1,
        headingLeft: headingRect ? headingRect.left - shellRect.left : -1,
        headingLineContent: headingLineStyle?.content || '',
        headingLineLeft,
        headingLineRight,
        headingLineWidth,
        previewColor: preview ? getComputedStyle(preview).color : '',
        paragraphColor: paragraph ? getComputedStyle(paragraph).color : '',
        headingColor: heading ? getComputedStyle(heading).color : '',
      };
    });
    const shellBackground = rgbValue(bodyShape.shellBackground);
    const paragraphColor = rgbValue(bodyShape.paragraphColor);
    if (!shellBackground || bodyShape.shellBackground !== bodyShape.tocBackground) {
      throw new Error(`markdown body should use the same background as the toc rail, got: ${JSON.stringify(bodyShape)}`);
    }
    if (!paragraphColor || paragraphColor[0] !== 215 || paragraphColor[1] !== 217 || paragraphColor[2] !== 223) {
      throw new Error(`markdown body text should use the target neutral foreground, got: ${JSON.stringify(bodyShape)}`);
    }
    if (bodyShape.previewLeft < 48 || bodyShape.previewLeft > 62 || bodyShape.tocLeft + 1 < bodyShape.previewRight) {
      throw new Error(`preview should reserve a left line gutter and place TOC on the right, got: ${JSON.stringify(bodyShape)}`);
    }
    if (bodyShape.shellGutterContent !== '""' || !bodyShape.shellGutterBackground) {
      throw new Error(`preview shell should render a visible left gutter, got: ${JSON.stringify(bodyShape)}`);
    }
    if (
      !bodyShape.headingLineContent.includes('1')
      || bodyShape.headingLineWidth < 24
      || bodyShape.headingLineLeft < bodyShape.previewLeft
      || bodyShape.headingLineRight > bodyShape.headingLeft - 4
    ) {
      throw new Error(`preview line labels should be visible before block text inside the preview scroll box, got: ${JSON.stringify(bodyShape)}`);
    }

    const codeShape = await editor.locator('.markdown-preview pre').first().evaluate(pre => {
      const code = pre.querySelector('code');
      const token = pre.querySelector('.hljs-keyword, .hljs-title, .hljs-string, .hljs-attr');
      const preStyle = getComputedStyle(pre);
      const codeStyle = code ? getComputedStyle(code) : null;
      const tokenStyle = token ? getComputedStyle(token) : null;
      return {
        preBackground: preStyle.backgroundColor,
        preBorder: preStyle.borderTopColor,
        preBorderLeft: preStyle.borderLeftColor,
        preBorderLeftWidth: preStyle.borderLeftWidth,
        codeClass: code?.className || '',
        lang: code?.getAttribute('data-lang') || '',
        languageLabel: pre.getAttribute('data-language-label') || '',
        lineLabel: pre.getAttribute('data-line-label') || '',
        lineStart: pre.getAttribute('data-line-start') || '',
        lineEnd: pre.getAttribute('data-line-end') || '',
        codeLineCount: pre.querySelectorAll('.code-line').length,
        pseudoLineLabel: getComputedStyle(pre, '::before').content || '',
        pseudoLanguageLabel: getComputedStyle(pre, '::after').content || '',
        tokenText: token?.textContent || '',
        tokenColor: tokenStyle?.color || '',
        codeColor: codeStyle?.color || '',
      };
    });
    const background = rgbValue(codeShape.preBackground);
    if (!background || background[0] !== 43 || background[1] !== 45 || background[2] !== 49) {
      throw new Error(`code block should use the target image surface, got: ${JSON.stringify(codeShape)}`);
    }
    if (Number.parseFloat(codeShape.preBorderLeftWidth) > 1.1 || codeShape.preBorderLeft !== codeShape.preBorder) {
      throw new Error(`code block should not show a colored left accent border, got: ${JSON.stringify(codeShape)}`);
    }
    if (!codeShape.codeClass.includes('hljs') || codeShape.lang !== 'javascript') {
      throw new Error(`javascript code block should be highlighted, got: ${JSON.stringify(codeShape)}`);
    }
    if (codeShape.languageLabel !== 'JavaScript' || !codeShape.pseudoLanguageLabel.includes('JavaScript')) {
      throw new Error(`javascript code block should expose a language label, got: ${JSON.stringify(codeShape)}`);
    }
    if (codeShape.lineStart !== '6' || codeShape.lineEnd !== '9' || codeShape.lineLabel !== '6-9' || !codeShape.pseudoLineLabel.includes('6-9')) {
      throw new Error(`javascript code block should show one whole-document line range, got: ${JSON.stringify(codeShape)}`);
    }
    if (codeShape.codeLineCount !== 0) {
      throw new Error(`javascript code block must not render per-code-line wrappers, got: ${JSON.stringify(codeShape)}`);
    }
    if (!codeShape.tokenText || !codeShape.tokenColor || codeShape.tokenColor === codeShape.codeColor) {
      throw new Error(`highlight tokens should have visible token colors, got: ${JSON.stringify(codeShape)}`);
    }

    const yamlLang = await editor.locator('.markdown-preview pre code.hljs').nth(1).getAttribute('data-lang');
    if (yamlLang !== 'yaml') {
      throw new Error(`yaml code block should be highlighted as yaml, got: ${yamlLang}`);
    }

    const bashShape = await editor.locator('.markdown-preview pre code[data-lang="bash"]').evaluate(code => {
      const token = code.querySelector('.hljs-string, .hljs-variable, .hljs-attr, .hljs-attribute, .hljs-property');
      const codeStyle = getComputedStyle(code);
      const tokenStyle = token ? getComputedStyle(token) : null;
      return {
        tokenText: token?.textContent || '',
        tokenColor: tokenStyle?.color || '',
        codeColor: codeStyle.color || '',
        languageLabel: code.closest('pre')?.getAttribute('data-language-label') || '',
      };
    });
    if (!bashShape.tokenText || !bashShape.tokenColor || bashShape.tokenColor === bashShape.codeColor) {
      throw new Error(`bash command arguments should use token-based highlight colors, got: ${JSON.stringify(bashShape)}`);
    }
    if (bashShape.languageLabel !== 'Shell') {
      throw new Error(`bash code block should expose the Shell label, got: ${JSON.stringify(bashShape)}`);
    }

    const fallbackShape = await editor.locator('.markdown-preview pre').last().evaluate(pre => {
      const code = pre.querySelector('code');
      return {
        lang: code?.getAttribute('data-lang') || '',
        codeClass: code?.className || '',
        languageLabel: pre.getAttribute('data-language-label') || '',
      };
    });
    if (fallbackShape.lang !== 'text' || fallbackShape.codeClass.includes('hljs') || fallbackShape.languageLabel !== 'Text') {
      throw new Error(`unlabeled code block should fall back to plain Text, got: ${JSON.stringify(fallbackShape)}`);
    }

    await editor.locator('.workspace-file-row').filter({ hasText: 'config.yaml' }).first().click();
    await editor.waitForFunction(() => document.querySelector('.markdown-preview pre code')?.textContent?.includes('service: appserver'));
    const yamlFileShape = await editor.locator('.markdown-preview pre').first().evaluate(pre => {
      const code = pre.querySelector('code');
      return {
        lang: code?.getAttribute('data-lang') || '',
        languageLabel: pre.getAttribute('data-language-label') || '',
        text: code?.textContent || '',
        renderedText: pre.innerText,
        lineLabel: pre.getAttribute('data-line-label') || '',
      };
    });
    if (
      yamlFileShape.lang !== 'yaml'
      || yamlFileShape.languageLabel !== 'YAML'
      || !yamlFileShape.text.includes('service: appserver\nreminderUrl: true')
      || !yamlFileShape.renderedText.includes('service: appserver')
      || !yamlFileShape.lineLabel.includes('1-2')
    ) {
      throw new Error(`yaml file preview should preserve source lines as a YAML code block, got: ${JSON.stringify(yamlFileShape)}`);
    }

    console.log(`${executablePath ? 'packaged ' : ''}react code highlight and yaml checks passed`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
