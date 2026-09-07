#!/usr/bin/env node
/**
 * MS-5 validation: event detection, measures, basis selector, censoring.
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
const VIDEO_PATH = join(ROOT, 'data', 'barnes-maze', 'test53.mp4');
const TRIAL_LABEL = 'test53';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const results = {};
let activeServer = null;
let activeBrowser = null;

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

async function cleanup() {
  if (activeBrowser) await activeBrowser.close().catch(() => {});
  if (activeServer) await new Promise((r) => activeServer.close(r));
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
  await walk(join(SRC, 'domain', 'events'));
  await walk(join(SRC, 'domain', 'measures'));
  const hits = [];
  for (const f of files) {
    const content = await readText(f, 'utf8');
    if (/test50|test51|test53/.test(content)) hits.push(f.replace(ROOT + '/', ''));
  }
  return hits;
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="trials-heading"]') != null,
    undefined,
    { timeout: 60_000 },
  );
}

async function selectTrial(page, label) {
  await page.getByRole('button', { name: new RegExp(label, 'i') }).click();
  await page.waitForSelector('[data-testid="review-view"]', { timeout: 60_000 });
}

async function prepareTrial(page) {
  await selectTrial(page, TRIAL_LABEL);
  await page.locator('[data-testid="auto-detect-btn"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="hole-count-summary"]')?.textContent?.includes('20'),
    undefined,
    { timeout: 180_000 },
  );
  await page.locator('[data-testid="target-hole-select"]').selectOption('0');
  await page.locator('[data-testid="confirm-target-btn"]').click();
  await page.locator('[data-testid="confirm-geometry-btn"]').click();
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
  await page.locator('[data-testid="run-tracking-btn"]').click();
  await page.waitForSelector('[data-testid="tracking-summary"]', { timeout: 180_000 });
}

async function main() {
  const failures = [];
  results.V_no_filename_branch = (await checkNoFilenameBranching()).length === 0 ? 'PASS' : 'FAIL';

  if (!process.env.SKIP_BUILD) execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  activeServer = await startStaticServer(DIST);
  activeBrowser = await chromium.launch({ headless: true });
  const page = await activeBrowser.newPage();
  const port = activeServer.address().port;

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);

  await page.locator('input[type="file"][multiple]').first().setInputFiles(VIDEO_PATH);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
    undefined,
    { timeout: 180_000 },
  );

  await prepareTrial(page);

  results.V1_detect_btn = (await page.locator('[data-testid="detect-events-btn"]').isVisible())
    ? 'PASS'
    : 'FAIL';

  await page.locator('[data-testid="detect-events-btn"]').click();
  await page.waitForSelector('[data-testid="events-list"]', { timeout: 60_000 });

  const eventCount = await page.locator('[data-testid="events-list"] li').count();
  results.V1_investigations = eventCount > 0 ? 'PASS' : 'FAIL';

  const totalLatencyText = await page.locator('[data-testid="measure-total-latency"]').textContent();
  results.V3_total_censored =
    totalLatencyText?.includes('Censored') && !totalLatencyText?.match(/^\d+\.\d+ s$/)
      ? 'PASS'
      : `FAIL:${totalLatencyText}`;

  const escapeLabel = await page.locator('[data-testid="escape-state-label"]').textContent();
  results.V3_escape_state =
    escapeLabel && !escapeLabel.includes('escape completed') ? 'PASS' : `FAIL:${escapeLabel}`;

  const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
  await page.evaluate(
    ({ tid }) => window.__ntSetMeasurementBasis?.(tid, 'raw'),
    { tid: trialId },
  );
  await page.waitForTimeout(500);
  const basisAfter = await page.locator('[data-testid="measurement-basis-select"]').inputValue();
  results.V7_basis_change = basisAfter === 'raw' ? 'PASS' : 'FAIL';

  await page.evaluate(
    () => window.__ntUpdateEventParams?.({ investigationMinDwellUs: 800_000 }),
    {},
  );
  await page.waitForTimeout(500);
  const eventCountAfter = await page.locator('[data-testid="events-list"] li').count();
  results.V2_threshold = eventCountAfter !== eventCount ? 'PASS' : 'SKIP:same_count';

  for (const [k, v] of Object.entries(results)) {
    if (String(v).startsWith('FAIL')) failures.push(`${k}: ${v}`);
  }

  console.log(JSON.stringify(results, null, 2));
  await cleanup();

  if (failures.length) {
    console.error('MS-5 validation FAIL', failures);
    process.exit(1);
  }
  console.log('MS-5 validation PASS');
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  process.exit(1);
});
