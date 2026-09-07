#!/usr/bin/env node
/** Verify preview raw ghost marker data at test50 display frame 3795 (cleaning window 7). */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const VIDEO = join(ROOT, 'data', 'barnes-maze', 'test50.mp4');
const FRAME = 3794; // display 3795
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        let p = req.url?.split('?')[0] ?? '/';
        if (p === '/') p = '/index.html';
        const data = await readFile(join(DIST, p));
        const ext = p.slice(p.lastIndexOf('.'));
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const server = await startServer();
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('NeuroTrack'), undefined, { timeout: 60000 });

  const videoBuf = await readFile(VIDEO);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'test50.mp4',
    mimeType: 'video/mp4',
    buffer: videoBuf,
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('test50')),
    undefined,
    { timeout: 180000 },
  );

  await page.getByRole('button', { name: /test50/i }).click();
  await page.waitForSelector('[data-testid="review-view"]', { timeout: 120000 });
  await page.locator('[data-testid="auto-detect-btn"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="hole-count-summary"]')?.textContent?.includes('20'),
    undefined,
    { timeout: 180000 },
  );
  await page.locator('[data-testid="target-hole-select"]').selectOption('0');
  await page.locator('[data-testid="confirm-target-btn"]').click();
  await page.locator('[data-testid="confirm-geometry-btn"]').click();
  await page.waitForSelector('[data-testid="geometry-confirmed"]');
  await page.locator('[data-testid="propose-window-btn"]').click();
  await page.waitForFunction(
    () => {
      const s = document.querySelector('[data-testid="start-time-input"]');
      return s && parseFloat(s.value) > 0;
    },
    undefined,
    { timeout: 180000 },
  );
  await page.locator('[data-testid="confirm-window-btn"]').click();
  await page.locator('[data-testid="run-tracking-btn"]').click();
  await page.waitForSelector('[data-testid="tracking-summary"]', { timeout: 300000 });

  await page.locator('[data-testid="goto-frame-input"]').fill(String(FRAME + 1));
  await page.locator('[data-testid="goto-frame-input"]').press('Enter');
  await page.waitForFunction(
    (n) => document.querySelector('[data-testid="current-frame-index"]')?.textContent?.includes(`Frame ${n}/`),
    FRAME + 1,
    { timeout: 120000 },
  );

  await page.locator('[data-testid="clean-smoothing-window"]').fill('7');
  const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
  await page.evaluate((tid) => window.__ntPreviewCleaning?.(tid), trialId);
  await page.waitForSelector('[data-testid="clean-preview-active"]');

  const compareText = await page.locator('[data-testid="clean-preview-compare"]').textContent();
  const rawX = await page.locator('[data-testid="preview-raw-body-x"]').textContent();
  const rawY = await page.locator('[data-testid="preview-raw-body-y"]').textContent();
  const markerActive = await page
    .locator('[data-testid="preview-raw-marker-active"]')
    .getAttribute('data-active');
  const previewX = await page.locator('[data-testid="observation-body-x"]').textContent();
  const previewY = await page.locator('[data-testid="observation-body-y"]').textContent();

  const deltaMatch = compareText?.match(/Δ = ([\d.]+) px/);
  const delta = deltaMatch ? Number(deltaMatch[1]) : 0;

  const result = {
    displayFrame: FRAME + 1,
    compareText,
    deltaPx: delta,
    rawBody: rawX && rawY ? { x: Number(rawX), y: Number(rawY) } : null,
    previewBody: previewX && previewY ? { x: Number(previewX), y: Number(previewY) } : null,
    markerActive,
    pass:
      delta >= 6 &&
      markerActive === 'true' &&
      rawX != null &&
      rawY != null &&
      compareText?.includes('origin: smoothed'),
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) {
    console.error('test50 frame 3795 ghost marker verification FAIL');
    process.exit(1);
  }
  console.log('test50 frame 3795 ghost marker verification PASS');
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
