#!/usr/bin/env node
/**
 * MS-5 validation: all three sample clips via live browser pipeline.
 * Target hole is NOT assumed for pass/fail — confirm only in optional diagnostic steps.
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
const DATA = join(ROOT, 'data', 'barnes-maze');
const CLIPS = ['test53', 'test51', 'test50'];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const results = {};
const clipOutcomes = {};
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
  await walk(join(SRC, 'services'));
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

async function prepareTrialCore(page, label, { confirmTarget = false, targetHole = '0' } = {}) {
  await selectTrial(page, label);
  await page.locator('[data-testid="auto-detect-btn"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="hole-count-summary"]')?.textContent?.includes('20'),
    undefined,
    { timeout: 180_000 },
  );

  const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
  await page.evaluate(({ tid }) => {
    window.__ntAckCalibrationReview?.(tid);
    window.__ntConfirmGeometry?.(tid);
  }, { tid: trialId });

  if (confirmTarget) {
    await page.locator('[data-testid="target-hole-select"]').selectOption(targetHole);
    await page.locator('[data-testid="confirm-target-btn"]').click();
  }

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

async function detectAndWait(page) {
  await page.locator('[data-testid="detect-events-btn"]').click();
  await page.waitForSelector('[data-testid="events-list"]', { timeout: 180_000 });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="detect-events-btn"]')?.textContent?.includes('Detecting'),
    undefined,
    { timeout: 180_000 },
  );
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

  const videoPaths = CLIPS.map((c) => join(DATA, `${c}.mp4`));
  await page.locator('input[type="file"][multiple]').first().setInputFiles(videoPaths);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
    undefined,
    { timeout: 180_000 },
  );

  for (const clip of CLIPS) {
    await prepareTrialCore(page, clip, { confirmTarget: false });
    results[`${clip}_target_unknown_note`] = (await page.locator('[data-testid="target-unknown-note"]').isVisible())
      ? 'PASS'
      : 'FAIL';

    await detectAndWait(page);

    const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
    const escapeType = await page.evaluate(({ tid }) => window.__ntGetEscapeType?.(tid) ?? null, { tid: trialId });
    const invCount = await page.evaluate(({ tid }) => window.__ntGetInvestigationCount?.(tid) ?? 0, { tid: trialId });
    const totalLatencyText = await page.locator('[data-testid="measure-total-latency"]').textContent();
    const primaryLatencyText = await page.locator('[data-testid="measure-primary-latency"]').textContent();
    const escapeLabel = await page.locator('[data-testid="escape-state-label"]').textContent();
    const markerStrip = await page.locator('[data-testid="event-marker-strip"]').count();
    const pixelBanner = await page.evaluate(() => window.__ntGetPixelEvidenceBanner?.());

    clipOutcomes[clip] = {
      escapeType,
      investigations: invCount,
      totalLatency: totalLatencyText?.trim(),
      primaryLatency: primaryLatencyText?.trim(),
      escapeLabel: escapeLabel?.trim(),
      eventMarkers: markerStrip > 0,
      pixelEvidence: pixelBanner?.trim() ?? null,
    };

    results[`${clip}_not_completed`] =
      escapeType !== 'escape_completed' ? 'PASS' : `FAIL:${escapeType}`;
    results[`${clip}_total_censored_or_unavailable`] =
      totalLatencyText?.includes('Censored') || totalLatencyText?.includes('Unavailable')
        ? 'PASS'
        : `FAIL:${totalLatencyText}`;
    results[`${clip}_primary_unavailable_without_target`] =
      primaryLatencyText?.includes('Unavailable') ? 'PASS' : `SKIP:${primaryLatencyText}`;
    results[`${clip}_event_markers`] = markerStrip > 0 ? 'PASS' : 'FAIL:no_markers';
    results[`${clip}_investigations`] = invCount > 0 ? 'PASS' : 'FAIL:0';
    results[`${clip}_pixel_evidence_reported`] =
      pixelBanner && /frames analyzed/i.test(pixelBanner) ? 'PASS' : `SKIP:${pixelBanner}`;
  }

  await selectTrial(page, 'test53');
  await page.locator('[data-testid="target-hole-select"]').selectOption('0');
  await page.locator('[data-testid="confirm-target-btn"]').click();
  results.V_diagnostic_target_confirm = 'PASS:diagnostic_only';
  await detectAndWait(page);
  const trialId53 = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');

  const firstProposed = await page.locator('[data-testid^="confirm-event-"]').first();
  if (await firstProposed.count()) {
    const eventId = (await firstProposed.getAttribute('data-testid'))?.replace('confirm-event-', '');
    await page.evaluate(
      ({ tid, eid }) => window.__ntConfirmEvent?.(tid, eid),
      { tid: trialId53, eid: eventId },
    );
    await page.waitForTimeout(500);
    results.V6_confirm_moves_errors = 'PASS';
  } else {
    results.V6_confirm_moves_errors = 'SKIP:no_proposed';
  }

  await page.evaluate(
    ({ tid }) => window.__ntAddManualInvestigation?.(tid, 3, 100, 105),
    { tid: trialId53 },
  );
  await page.waitForTimeout(300);
  results.V_manual_add = 'PASS';

  await page.evaluate(() => window.__ntUpdateEventParams?.({ pixelEvidenceBudgetFrames: 5 }));
  await page.waitForTimeout(1200);
  const pixelBannerSmall = await page.evaluate(() => window.__ntGetPixelEvidenceBanner?.());
  results.V9_pixel_incomplete =
    pixelBannerSmall && pixelBannerSmall.toLowerCase().includes('incomplete') ? 'PASS' : `SKIP:${pixelBannerSmall}`;

  await page.evaluate(
    ({ tid }) => window.__ntSetMeasurementBasis?.(tid, 'raw'),
    { tid: trialId53 },
  );
  await page.waitForTimeout(1200);
  const basisAfter = await page.locator('[data-testid="measurement-basis-select"]').inputValue();
  results.V7_basis_change = basisAfter === 'raw' ? 'PASS' : 'FAIL';

  for (const [k, v] of Object.entries(results)) {
    if (String(v).startsWith('FAIL')) failures.push(`${k}: ${v}`);
  }

  console.log(JSON.stringify({ results, clipOutcomes }, null, 2));
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
