#!/usr/bin/env node
/**
 * MS-3 validation: tracking pipeline UI, isolation, persistence, flagged-frame seek.
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
const VIDEO_PATHS = ['test50.mp4', 'test51.mp4', 'test53.mp4'].map((f) =>
  join(ROOT, 'data', 'barnes-maze', f),
);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const results = {};

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

async function checkNoFilenameBranching() {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'workers') continue;
      if (entry.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) files.push(p);
      else if (entry.isDirectory()) await walk(p);
    }
  }
  await walk(join(SRC, 'domain', 'tracking'));
  const hits = [];
  for (const f of files) {
    const content = await readText(f, 'utf8');
    if (/test50|test51|test53/.test(content)) hits.push(f.replace(ROOT + '/', ''));
  }
  const svcPath = join(SRC, 'services', 'trackingService.ts');
  try {
    const content = await readText(svcPath, 'utf8');
    if (/test50|test51|test53/.test(content)) hits.push('src/services/trackingService.ts');
  } catch {
    /* ignore */
  }
  return hits;
}

async function setupTrials(page) {
  await page.goto(`http://127.0.0.1:8779/`);
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('NeuroTrack'));
  await page.locator('input[type="file"][multiple]').first().setInputFiles(VIDEO_PATHS);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
    { timeout: 180_000 },
  );
}

async function selectTrial(page, label) {
  await page.getByRole('button', { name: new RegExp(label, 'i') }).click();
  await page.waitForSelector('[data-testid="review-view"]', { timeout: 60_000 });
  await page.waitForSelector('[data-testid="current-timestamp"]', { timeout: 120_000 });
}

async function prepareTrialForTracking(page, label) {
  await selectTrial(page, label);
  await page.locator('[data-testid="auto-detect-btn"]').click({ timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="hole-count-summary"]')?.textContent?.includes('20'),
    { timeout: 180_000 },
  );

  if (label === 'test51') {
    const ack = page.locator('[data-testid="calibration-review-ack"]');
    if (await ack.isVisible()) {
      await ack.click();
      await page.waitForSelector('[data-testid="calibration-review-acknowledged"]', {
        timeout: 10_000,
      });
    }
  }

  await page.evaluate(() => {
    const sel = document.querySelector('[data-testid="target-hole-select"]');
    if (sel) {
      sel.value = '0';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.locator('[data-testid="confirm-target-btn"]').click();
  await page.waitForSelector('[data-testid="target-confirmed"]', { timeout: 15_000 });
  await page.locator('[data-testid="confirm-geometry-btn"]').click();
  await page.waitForSelector('[data-testid="geometry-confirmed"]', { timeout: 15_000 });

  await page.locator('[data-testid="propose-window-btn"]').click();
  await page.waitForFunction(
    () => {
      const start = document.querySelector('[data-testid="start-time-input"]');
      return start && start.value && parseFloat(start.value) > 0;
    },
    { timeout: 180_000 },
  );
  await page.locator('[data-testid="confirm-window-btn"]').click();
  await page.waitForSelector('[data-testid="window-confirmed"]', { timeout: 15_000 });
}

async function runTrackingAndWait(page, timeoutMs = 600_000) {
  await page.locator('[data-testid="run-tracking-btn"]').click();
  await page.waitForFunction(
    () => {
      const msg = document.querySelector('[data-testid="status-message"]')?.textContent ?? '';
      return msg.includes('Tracking complete') || msg.includes('Tracking failed') || msg.includes('cancelled');
    },
    { timeout: timeoutMs },
  );
}

async function readTrackingSummary(page) {
  const summary = await page.locator('[data-testid="tracking-summary"]').textContent().catch(() => null);
  const assessment = await page.locator('[data-testid="tracking-assessment"]').textContent().catch(() => null);
  const trackedPct = summary?.match(/([\d.]+)%/)?.[1] ?? null;
  return { summary: summary?.trim() ?? null, assessment: assessment?.trim() ?? null, trackedPct };
}

async function main() {
  const failures = [];
  const port = 8779;

  const filenameHits = await checkNoFilenameBranching();
  results.V2 = filenameHits.length === 0 ? 'PASS' : `FAIL: ${filenameHits.join(', ')}`;
  if (filenameHits.length) failures.push(`V2: filename branching`);

  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  const server = await startStaticServer(port, DIST);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await setupTrials(page);

  // V8 — gating without confirmed geometry/window
  await selectTrial(page, 'test53');
  const gateBefore = await page.locator('[data-testid="tracking-gate-message"]').textContent();
  const runDisabled = await page.locator('[data-testid="run-tracking-btn"]').isDisabled();
  results.V8 = gateBefore?.includes('Confirm maze geometry') && runDisabled ? 'PASS' : 'FAIL';
  if (results.V8 !== 'PASS') failures.push(`V8: gating ${gateBefore}`);

  await prepareTrialForTracking(page, 'test53');
  const gateAfter = await page.locator('[data-testid="tracking-gate-message"]').isVisible().catch(() => false);
  results.V8b = !gateAfter ? 'PASS' : 'FAIL';
  if (results.V8b !== 'PASS') failures.push('V8b: gate still visible after prep');

  // V1/V3 — run tracking on test53 (short clip)
  await runTrackingAndWait(page, 600_000);
  const statusAfter53 = await page.locator('[data-testid="status-message"]').textContent();
  const trackErr53 = await page
    .locator('[data-testid="tracking-error"]')
    .textContent()
    .catch(() => null);
  console.log('test53 tracking status:', statusAfter53, trackErr53);
  const test53Track = await readTrackingSummary(page);
  const stripVisible = await page.locator('[data-testid="tracking-quality-strip"]').isVisible();
  results.V1 = test53Track.summary?.includes('Tracked')
    ? 'PASS'
    : `FAIL: summary=${test53Track.summary} status=${statusAfter53}`;
  results.V3 = stripVisible ? 'PASS' : 'FAIL';
  if (results.V1 !== 'PASS') failures.push(`V1: ${test53Track.summary}`);
  if (results.V3 !== 'PASS') failures.push('V3: quality strip missing');

  const trackedPct53 = parseFloat(test53Track.trackedPct ?? '0');
  if (trackedPct53 < 60) {
    failures.push(`V9-ui: test53 tracked ${trackedPct53}% < 60%`);
    results.V9 = 'FAIL';
  } else {
    results.V9 = 'PASS';
  }

  // V6 — flagged frame seek
  const flaggedBtn = page.locator('[data-testid^="flagged-frame-"]').first();
  if (await flaggedBtn.isVisible()) {
    const before = await page.locator('[data-testid="current-frame-index"]').textContent();
    await flaggedBtn.click();
    await page.waitForTimeout(1000);
    const after = await page.locator('[data-testid="current-frame-index"]').textContent();
    results.V6 = before !== after ? 'PASS' : 'FAIL';
  } else {
    results.V6 = test53Track.assessment === 'high' ? 'PASS (no flags — high quality)' : 'SKIP';
  }
  if (results.V6 === 'FAIL') failures.push('V6: flagged frame seek did not change frame');

  // V4 — persistence
  const snap53 = test53Track;
  await page.reload();
  await page.waitForSelector('[data-testid="trials-heading"]');
  await selectTrial(page, 'test53');
  const afterReload = await readTrackingSummary(page);
  results.V4 = afterReload.summary === snap53.summary ? 'PASS' : `FAIL: ${afterReload.summary}`;
  if (results.V4 !== 'PASS') failures.push(`V4: reload ${afterReload.summary}`);

  // V5 — cross-trial isolation
  await prepareTrialForTracking(page, 'test51');
  await runTrackingAndWait(page, 600_000);
  const test51Track = await readTrackingSummary(page);
  await selectTrial(page, 'test53');
  const test53Again = await readTrackingSummary(page);
  const distinct = test51Track.summary !== test53Again.summary || test51Track.assessment !== test53Again.assessment;
  results.V5 = distinct && test53Again.summary === snap53.summary ? 'PASS' : 'FAIL';
  if (results.V5 !== 'PASS') failures.push('V5: cross-trial track leakage');

  // V7 — test51 tracking completes (cylinder rejection via worker)
  results.V7 = test51Track.summary?.includes('Tracked') ? 'PASS' : 'FAIL';
  if (results.V7 !== 'PASS') failures.push(`V7: test51 ${test51Track.summary}`);

  await browser.close();
  server.close();

  console.log(JSON.stringify(results, null, 2));
  if (failures.length) {
    console.error('MS-3 validation FAIL:', failures);
    process.exit(1);
  }
  console.log('MS-3 validation PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
