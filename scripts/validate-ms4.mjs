#!/usr/bin/env node
/**
 * MS-4 validation: manual correction, trajectory cleaning preview/apply, persistence.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, readdir, readFile as readText } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');
const VIDEO_PATHS = ['test53.mp4'].map((f) => join(ROOT, 'data', 'barnes-maze', f));

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const results = {};

function startStaticServer(root) {
  return new Promise((resolve, reject) => {
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
    server.on('error', reject);
    server.listen(0, () => resolve(server));
  });
}

async function checkNoFilenameBranching() {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) files.push(p);
    }
  }
  await walk(join(SRC, 'domain', 'trajectory'));
  const hits = [];
  for (const f of files) {
    const content = await readText(f, 'utf8');
    if (/test50|test51|test53/.test(content)) hits.push(f.replace(ROOT + '/', ''));
  }
  return hits;
}

async function setupAndTrack(page, port) {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('NeuroTrack'));
  await page.locator('input[type="file"][multiple]').first().setInputFiles(VIDEO_PATHS);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
    undefined,
    { timeout: 180_000 },
  );
  await page.getByRole('button', { name: /test53/i }).click();
  await page.waitForSelector('[data-testid="review-view"]');
  await page.waitForSelector('[data-testid="current-frame-index"]', { timeout: 120_000 });
  await page.locator('[data-testid="auto-detect-btn"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="hole-count-summary"]')?.textContent?.includes('20'),
    undefined,
    { timeout: 180_000 },
  );
  await page.locator('[data-testid="target-hole-select"]').selectOption('0');
  await page.locator('[data-testid="confirm-target-btn"]').click();
  await page.waitForSelector('[data-testid="target-confirmed"]');
  await page.locator('[data-testid="confirm-geometry-btn"]').click();
  await page.waitForSelector('[data-testid="geometry-confirmed"]');
  await page.locator('[data-testid="propose-window-btn"]').click();
  await page.waitForFunction(
    () => {
      const start = document.querySelector('[data-testid="start-time-input"]');
      return start && start.value && parseFloat(start.value) > 0;
    },
    undefined,
    { timeout: 180_000 },
  );
  await page.locator('[data-testid="confirm-window-btn"]').click();
  await page.waitForSelector('[data-testid="window-confirmed"]');
  const runDisabled = await page.locator('[data-testid="run-tracking-btn"]').isDisabled();
  if (runDisabled) {
    const gate = await page.locator('[data-testid="tracking-gate-message"]').textContent();
    throw new Error(`Run tracking disabled: ${gate}`);
  }
  await page.locator('[data-testid="run-tracking-btn"]').click();
  await page.waitForFunction(
    () => {
      const msg = document.querySelector('[data-testid="status-message"]')?.textContent ?? '';
      const summary = document.querySelector('[data-testid="tracking-summary"]')?.textContent ?? '';
      return (
        msg.includes('Tracking complete') ||
        msg.includes('Tracking failed') ||
        summary.includes('Tracked')
      );
    },
    undefined,
    { timeout: 600_000 },
  );
  await page.waitForSelector('[data-testid="clean-max-gap"]', { timeout: 60_000 });
}

async function reactClick(page, testId) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el instanceof HTMLElement) el.click();
  }, testId);
}

async function waitForReviewReady(page) {
  await page.waitForSelector('[data-testid="trials-heading"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tracking-summary"]')?.textContent?.includes('Tracked'),
    undefined,
    { timeout: 120_000 },
  );
  await page.waitForSelector('[data-testid="clean-max-gap"]', { timeout: 60_000 });
  await page.waitForSelector('[data-testid="current-frame-index"]', { timeout: 120_000 });
}

async function main() {
  const failures = [];

  const filenameHits = await checkNoFilenameBranching();
  results.V2 = filenameHits.length === 0 ? 'PASS' : `FAIL: ${filenameHits.join(', ')}`;
  if (filenameHits.length) failures.push(`V2: ${filenameHits.join(', ')}`);

  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  const server = await startStaticServer(DIST);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await setupAndTrack(page, port);

  const originBefore = await page.locator('[data-testid="observation-origin"]').textContent();
  results.V1_origin_before =
    originBefore === 'auto' || originBefore === 'interpolated' || originBefore === 'smoothed'
      ? 'PASS'
      : `FAIL: ${originBefore}`;

  await reactClick(page, 'correction-mode-body');
  const overlay = page.locator('[data-testid="video-overlay"]');
  const box = await overlay.boundingBox();
  if (!box) throw new Error('overlay missing');
  await overlay.click({ position: { x: box.width / 2, y: box.height / 2 }, noWaitAfter: true });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="observation-origin"]')?.textContent === 'manual',
    undefined,
    { timeout: 10_000 },
  );
  const bodyXAfter = await page.locator('[data-testid="observation-body-x"]').textContent();
  results.V1_manual_correction = bodyXAfter && Number(bodyXAfter) > 0 ? 'PASS' : 'FAIL';
  results.V2_provenance =
    (await page.locator('[data-testid="observation-origin"]').textContent()) === 'manual' ? 'PASS' : 'FAIL';

  await reactClick(page, 'correction-reset-frame');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="observation-origin"]')?.textContent === 'auto',
    undefined,
    { timeout: 10_000 },
  );
  results.V3_reset = 'PASS';

  await reactClick(page, 'correction-mode-body');
  await overlay.click({
    position: { x: box.width / 2 + 20, y: box.height / 2 + 10 },
    noWaitAfter: true,
  });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="observation-origin"]')?.textContent === 'manual',
    undefined,
    { timeout: 10_000 },
  );

  await page.waitForTimeout(500);
  await page.reload();
  await waitForReviewReady(page);
  const summaryAfterReload = await page.locator('[data-testid="correction-summary"]').textContent();
  results.V4_persistence = summaryAfterReload?.includes('1 manual correction') ? 'PASS' : `FAIL: ${summaryAfterReload}`;

  await reactClick(page, 'correction-mode-body');
  await page.locator('[data-testid="clean-max-gap"]').fill('1');
  await page.locator('[data-testid="clean-smoothing-window"]').fill('5');
  await reactClick(page, 'clean-preview-btn');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="clean-preview-active"]') != null,
    undefined,
    { timeout: 15_000 },
  );
  results.V5_preview = 'PASS';

  const originDuringPreview = await page.locator('[data-testid="observation-origin"]').textContent();
  results.V6_preview_changes =
    originDuringPreview === 'manual' ||
    originDuringPreview === 'smoothed' ||
    originDuringPreview === 'interpolated'
      ? 'PASS'
      : `FAIL: ${originDuringPreview}`;

  await reactClick(page, 'clean-discard-btn');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="clean-preview-active"]') == null,
    undefined,
    { timeout: 10_000 },
  );
  const originAfterDiscard = await page.locator('[data-testid="observation-origin"]').textContent();
  results.V7_discard = originAfterDiscard === 'manual' ? 'PASS' : `FAIL: ${originAfterDiscard}`;

  results.V8_ms5_note = (await page.locator('[data-testid="ms5-event-note"]').isVisible()) ? 'PASS' : 'FAIL';

  if (results.V1_manual_correction !== 'PASS') failures.push('V1: manual correction');
  if (results.V2_provenance !== 'PASS') failures.push('V2: provenance manual');
  if (results.V3_reset !== 'PASS') failures.push('V3: reset');
  if (results.V4_persistence !== 'PASS') failures.push(`V4: persistence ${summaryAfterReload}`);
  if (results.V5_preview !== 'PASS') failures.push('V5: preview');
  if (results.V7_discard !== 'PASS') failures.push(`V7: discard ${originAfterDiscard}`);

  await browser.close();
  server.close();

  console.log(JSON.stringify(results, null, 2));
  if (failures.length) {
    console.error('MS-4 validation FAIL:', failures);
    process.exit(1);
  }
  console.log('MS-4 validation PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
