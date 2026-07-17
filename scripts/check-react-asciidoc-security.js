const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

async function waitForEditor(app) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const page = app.windows().find(window => window.url().includes('dist/renderer/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`React editor did not open: ${app.windows().map(window => window.url()).join(', ')}`);
}

async function dismissReleaseNotice(page) {
  const notice = page.locator('.release-notice-overlay');
  if (!await notice.isVisible().catch(() => false)) return;
  const confirm = notice.getByRole('button', { name: '확인' });
  if (await confirm.count()) await confirm.click();
  else await notice.click({ position: { x: 8, y: 8 } });
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-adoc-security-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docpilot-adoc-security-user-'));
  const documentPath = path.join(fixtureRoot, 'security.adoc');

  fs.writeFileSync(documentPath, `= Security Preview

== Preserved heading

NOTE: Preserved note content.

|===
|Key |Value
|safe |content
|===

[source,javascript]
----
const preserved = true;
----

++++
<script id="xss-script">document.documentElement.dataset.asciidocXss = 'script'</script>
<img id="xss-image" src="docpilot-invalid://image" onerror="document.documentElement.dataset.asciidocXss = 'event'">
<a id="xss-link" href="javascript:document.documentElement.dataset.asciidocXss = 'url'">Unsafe link</a>
<iframe id="xss-frame" srcdoc="<script>top.document.documentElement.dataset.asciidocXss = 'frame'</script>"></iframe>
<div id="xss-overlay" style="position:fixed;inset:0;z-index:2147483647">Overlay attempt</div>
<details id="safe-details"><summary>Preserved details</summary><p>Preserved details body.</p></details>
++++
`, 'utf8');

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCPILOT_FAKE_AGENT: '1',
      DOCPILOT_USER_DATA_DIR: userData,
    },
  });

  try {
    const start = await app.firstWindow();
    await start.evaluate(() => {
      localStorage.setItem('docpilot:terminal-open', '0');
      localStorage.setItem('docpilot:release-notice-seen-id', '2.0.1:r2');
    });
    await start.evaluate(root => window.docpilot.openFolder(root), fixtureRoot);

    const page = await waitForEditor(app);
    await page.waitForSelector('.workspace-sidebar');
    await dismissReleaseNotice(page);
    await page.locator('.workspace-file-row').filter({ hasText: 'security.adoc' }).click();
    await page.waitForSelector('.markdown-preview.adoc-preview h2');
    await page.waitForFunction(() => !document.querySelector('.docpilot-preview-loading'));
    await page.waitForTimeout(200);

    const result = await page.locator('.markdown-preview.adoc-preview').evaluate(preview => {
      const executableAttributes = Array.from(preview.querySelectorAll('*')).flatMap(node =>
        Array.from(node.attributes)
          .filter(attribute => /^on/i.test(attribute.name))
          .map(attribute => `${node.tagName.toLowerCase()}.${attribute.name}`),
      );
      const javascriptUrls = Array.from(preview.querySelectorAll('[href],[src],[action],[formaction]'))
        .flatMap(node => ['href', 'src', 'action', 'formaction']
          .map(name => node.getAttribute(name))
          .filter(value => /^\s*javascript:/i.test(value || '')));
      const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '';
      return {
        xssMarker: document.documentElement.dataset.asciidocXss || '',
        executableAttributes,
        javascriptUrls,
        scriptCount: preview.querySelectorAll('script').length,
        activeContentCount: preview.querySelectorAll('iframe,object,embed,form,input,button,textarea,select').length,
        imageOnError: preview.querySelector('#xss-image')?.getAttribute('onerror') || '',
        unsafeHref: preview.querySelector('#xss-link')?.getAttribute('href') || '',
        overlayStyle: preview.querySelector('#xss-overlay')?.getAttribute('style') || '',
        heading: preview.querySelector('h2')?.textContent?.trim() || '',
        note: preview.querySelector('.admonitionblock.note')?.textContent?.trim() || '',
        table: preview.querySelector('table.tableblock')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        code: preview.querySelector('pre code')?.textContent?.trim() || '',
        details: preview.querySelector('#safe-details')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        policy,
      };
    });

    assert.equal(result.xssMarker, '', `AsciiDoc executable markup ran: ${JSON.stringify(result)}`);
    assert.deepEqual(result.executableAttributes, [], `event-handler attributes survived: ${JSON.stringify(result)}`);
    assert.deepEqual(result.javascriptUrls, [], `javascript URLs survived: ${JSON.stringify(result)}`);
    assert.equal(result.scriptCount, 0, `script elements survived: ${JSON.stringify(result)}`);
    assert.equal(result.activeContentCount, 0, `active embedded content survived: ${JSON.stringify(result)}`);
    assert.equal(result.imageOnError, '');
    assert.equal(result.unsafeHref, '');
    assert.equal(result.overlayStyle, '');
    assert.equal(result.heading, 'Preserved heading');
    assert.match(result.note, /Preserved note content/);
    assert.match(result.table, /Key Value safe content/);
    assert.match(result.code, /const preserved = true/);
    assert.match(result.details, /Preserved details Preserved details body/);
    assert.match(result.policy, /script-src 'self'/);
    assert.doesNotMatch(result.policy, /script-src[^;]*'unsafe-inline'/);

    console.log('React AsciiDoc sanitization security check passed');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
