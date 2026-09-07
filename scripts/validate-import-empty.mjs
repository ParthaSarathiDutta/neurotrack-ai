#!/usr/bin/env node
/**
 * Empty-session bundle import regression: restore three-trial analysis without video bytes.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'ms6', 'three-trial-session.neurotrack.json');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="trials-heading"]') != null,
    undefined,
    { timeout: 60_000 },
  );
}

async function main() {
  try {
    await readFile(FIXTURE);
  } catch {
    console.error(`Missing fixture ${FIXTURE}. Run: WRITE_IMPORT_FIXTURE=1 node scripts/smoke-export-checkpoint1.mjs`);
    process.exit(1);
  }

  if (!process.env.SKIP_BUILD) execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  const server = await startStaticServer(DIST);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.evaluate(async () => {
      await window.__ntResetSession?.();
      window.__ntResetInvokeCounts?.();
    });
    await page.reload();
    await waitForAppReady(page);

    results.V_empty_session = (await page.locator('[data-testid="import-bundle-empty-btn"]').count()) > 0 ? 'PASS' : 'FAIL';
    results.V_no_trials_initial = (await page.getByText('No trials loaded yet.').count()) > 0 ? 'PASS' : 'FAIL';

    await page.locator('[data-testid="import-bundle-empty-input"]').setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => {
        const heading = document.querySelector('[data-testid="trials-heading"]')?.textContent ?? '';
        return heading.includes('(3)');
      },
      undefined,
      { timeout: 30_000 },
    );

    const trialCountText = await page.locator('[data-testid="trials-heading"]').textContent();
    results.V_three_trials_imported = trialCountText?.includes('(3)') ? 'PASS' : `FAIL:${trialCountText}`;

    const invokeCounts = await page.evaluate(() => ({
      tracking: window.__ntGetTrackingInvokeCount?.() ?? -1,
      detect: window.__ntGetDetectEventsInvokeCount?.() ?? -1,
    }));
    results.V_no_tracking_on_import = invokeCounts.tracking === 0 ? 'PASS' : `FAIL:${invokeCounts.tracking}`;
    results.V_no_detect_on_import = invokeCounts.detect === 0 ? 'PASS' : `FAIL:${invokeCounts.detect}`;

    await page.getByRole('button', { name: /test53/i }).click();
    await page.waitForSelector('[data-testid="results-report"]', { timeout: 15_000 });
    results.V_results_without_video = 'PASS';

    const latency = await page.locator('[data-testid="report-total-latency"]').textContent();
    results.V_test53_confirmed_latency =
      latency && /24\.4\d s/.test(latency) && !latency.includes('Censored') ? 'PASS' : `FAIL:${latency?.trim()}`;

    const escapeStatus = await page.locator('[data-testid="report-escape-state"]').textContent();
    results.V_test53_escape_copy =
      escapeStatus?.includes('Completion at') && !escapeStatus?.includes('Proposed') ? 'PASS' : `FAIL:${escapeStatus?.trim()}`;

    results.V_reselect_action =
      (await page.locator('[data-testid="reselect-video-btn"]').count()) > 0 ? 'PASS' : 'FAIL';

    await page.locator('[data-testid="import-bundle-ingest-input"]').setInputFiles(FIXTURE);
    await page.waitForSelector('[data-testid="import-collision-dialog"]', { timeout: 10_000 });
    await page.locator('[data-testid="import-collision-cancel-btn"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="import-collision-dialog"]') == null,
      undefined,
      { timeout: 5_000 },
    );
    const afterCancel = await page.locator('[data-testid="trials-heading"]').textContent();
    results.V_collision_cancel = afterCancel?.includes('(3)') ? 'PASS' : `FAIL:${afterCancel}`;
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }

  const failures = Object.entries(results).filter(([, v]) => String(v).startsWith('FAIL'));
  console.log(JSON.stringify({ results }, null, 2));
  if (failures.length) {
    console.error('Import empty-session validation FAIL', failures);
    process.exit(1);
  }
  console.log('Import empty-session validation PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
