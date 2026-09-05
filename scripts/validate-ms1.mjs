#!/usr/bin/env node
/**
 * MS-1 validation: ingest all three sample videos via Playwright + Chromium.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const VIDEO_PATHS = ['test50.mp4', 'test51.mp4', 'test53.mp4'].map((f) =>
  join(ROOT, 'data', 'barnes-maze', f),
);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function startStaticServer(port, root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let path = req.url?.split('?')[0] ?? '/';
        if (path === '/') path = '/index.html';
        const filePath = join(root, path);
        const data = await readFile(filePath);
        const ext = path.slice(path.lastIndexOf('.'));
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(port, () => resolve(server));
  });
}

async function main() {
  const port = 8777;
  const server = await startStaticServer(port, DIST);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('NeuroTrack'));

  await page.locator('input[type="file"][multiple]').first().setInputFiles(VIDEO_PATHS);

  await page.waitForFunction(
    () => document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
    { timeout: 180_000 },
  );

  await page.waitForSelector('[data-testid="trials-heading"]:has-text("Trials (3)")');

  await page.getByRole('button', { name: /test51/i }).click();
  const test51Rate = await page.locator('[data-testid="meta-frame-rate"] td').textContent();
  const test51Timescale = await page.locator('[data-testid="meta-timescale"] td').textContent();

  const failures = [];
  if (test51Timescale?.trim() !== '15000') {
    failures.push(`test51 timescale expected 15000, got ${test51Timescale}`);
  }
  if (test51Rate?.trim() !== '15000/1001') {
    failures.push(`test51 rate expected 15000/1001, got ${test51Rate}`);
  }

  // Persistence across refresh
  await page.reload();
  await page.waitForSelector('[data-testid="trials-heading"]:has-text("Trials (3")');

  // Evict blob cache and verify reselect preserves trial
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('NeuroTrackDB');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('videoBlobs', 'readwrite');
        tx.objectStore('videoBlobs').clear();
        tx.oncomplete = () => resolve(null);
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  await page.reload();
  await page.waitForSelector('text=Reselect video', { timeout: 15_000 });

  await page.getByRole('button', { name: /test53/i }).click();
  const labelBefore = await page.locator('[data-testid="trial-label-input"]').inputValue();

  await page.locator('input[type="file"]').last().setInputFiles([VIDEO_PATHS[2]]);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Re-associated'),
    { timeout: 15_000 },
  );

  const labelAfter = await page.locator('[data-testid="trial-label-input"]').inputValue();
  const sampleCount = await page.locator('[data-testid="meta-sample-count"]').textContent();

  if (labelBefore !== labelAfter) {
    failures.push('Trial label changed after reselect');
  }
  if (!sampleCount || Number(sampleCount) <= 0) {
    failures.push('Metadata not preserved after cache eviction');
  }

  await browser.close();
  server.close();

  if (failures.length) {
    console.error('MS-1 validation FAIL:', failures);
    process.exit(1);
  }

  console.log('MS-1 validation PASS', { test51Rate: test51Rate?.trim(), test51Timescale: test51Timescale?.trim(), labelAfter, sampleCount });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
