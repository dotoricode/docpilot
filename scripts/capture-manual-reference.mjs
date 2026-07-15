import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [url, outputPath, widthArg = '1440', heightArg = '1024'] = process.argv.slice(2);

if (!url || !outputPath) {
  throw new Error('Usage: node scripts/capture-manual-reference.mjs <url> <output.png> [width] [height]');
}

const width = Number.parseInt(widthArg, 10);
const height = Number.parseInt(heightArg, 10);

if (!Number.isFinite(width) || !Number.isFinite(height)) {
  throw new Error('Viewport width and height must be finite integers.');
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  reducedMotion: 'reduce',
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(300);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await page.screenshot({ path: outputPath, fullPage: false, animations: 'disabled' });
  console.log(JSON.stringify({ url, outputPath, width, height }));
} finally {
  await browser.close();
}
