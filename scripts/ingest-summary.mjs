#!/usr/bin/env node
/** Print ingest summary for all three sample videos (uses built worker via Playwright). */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const VIDEOS = ['test50.mp4', 'test51.mp4', 'test53.mp4'];

function serve(root, port) {
  return new Promise((resolve) => {
    const s = createServer(async (req, res) => {
      let p = req.url?.split('?')[0] ?? '/';
      if (p === '/') p = '/index.html';
      try {
        res.end(await readFile(join(root, p)));
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    s.listen(port, () => resolve(s));
  });
}

async function main() {
  const server = await serve(DIST, 8778);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8778/');
  await page.waitForFunction(() => document.querySelector('h1'));

  const paths = VIDEOS.map((f) => join(ROOT, 'data', 'barnes-maze', f));
  await page.locator('input[type="file"][multiple]').first().setInputFiles(paths);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
    { timeout: 180_000 },
  );

  const summary = [];
  for (const name of VIDEOS) {
    await page.getByRole('button', { name: new RegExp(name.replace('.mp4', ''), 'i') }).click();
    summary.push({
      file: name,
      timescale: await page.locator('[data-testid="meta-timescale"] td').textContent(),
      frameRate: await page.locator('[data-testid="meta-frame-rate"] td').textContent(),
      samples: await page.locator('[data-testid="meta-sample-count"] td').textContent(),
    });
  }

  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
  server.close();
}

main();
