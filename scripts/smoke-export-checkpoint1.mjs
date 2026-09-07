#!/usr/bin/env node
/**
 * MS-6 Checkpoint 1 export smoke test — three-trial session, confirm test53 escape, verify CSV/XLSX.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, mkdtemp, rm, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const DATA = join(ROOT, 'data', 'barnes-maze');
const CLIPS = ['test53', 'test51', 'test50'];

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

async function prepareTrialCore(page, label) {
  await page.getByRole('button', { name: new RegExp(label, 'i') }).click();
  await page.waitForSelector('[data-testid="review-view"]', { timeout: 60_000 });
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
  await page.locator('[data-testid="detect-events-btn"]').click();
  await page.waitForSelector('[data-testid="events-list"]', { timeout: 180_000 });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="detect-events-btn"]')?.textContent?.includes('Detecting'),
    undefined,
    { timeout: 180_000 },
  );
  return trialId;
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

async function main() {
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  const server = await startStaticServer(DIST);
  const port = server.address().port;
  const downloadDir = await mkdtemp(join(tmpdir(), 'nt-export-smoke-'));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const videoPaths = CLIPS.map((c) => join(DATA, `${c}.mp4`));
    await page.locator('input[type="file"][multiple]').first().setInputFiles(videoPaths);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
      undefined,
      { timeout: 300_000 },
    );
    results.V_session_ingest = 'PASS';

    const trialIds = {};
    for (const clip of CLIPS) {
      trialIds[clip] = await prepareTrialCore(page, clip);
    }
    results.V_all_trials_tracked = 'PASS';

    await page.getByRole('button', { name: /test53/i }).click();
    await page.waitForSelector('[data-testid="review-view"]', { timeout: 30_000 });

    const escapeConfirmBtn = page
      .locator('[data-testid^="event-row-escape_completed"]')
      .locator('[data-testid^="confirm-event-"]')
      .first();
    if (await escapeConfirmBtn.count()) {
      await escapeConfirmBtn.click();
      await page.waitForFunction(
        () => {
          const latency = document.querySelector('[data-testid="report-total-latency"]')?.textContent ?? '';
          return /\d+\.\d+ s/.test(latency) && !latency.includes('Censored');
        },
        undefined,
        { timeout: 15_000 },
      );
      results.V_test53_confirm = 'PASS';
    } else {
      results.V_test53_confirm = 'SKIP:no_proposed_escape';
    }

    const reportLatency = await page.locator('[data-testid="report-total-latency"]').textContent();
    results.V_test53_report_latency =
      reportLatency && /24\.4\d s/.test(reportLatency) ? 'PASS' : `CHECK:${reportLatency?.trim()}`;

    await page.evaluate(() => window.__ntFlushPersist?.());

    const xlsxDownload = page.waitForEvent('download', { timeout: 30_000 });
    await page.locator('[data-testid="export-session-xlsx-btn"]').click();
    const dl = await xlsxDownload;
    const xlsxPath = join(downloadDir, 'session.xlsx');
    await dl.saveAs(xlsxPath);

    const wb = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' });
    results.V_xlsx_sheets =
      JSON.stringify(wb.SheetNames) ===
      JSON.stringify(['Summary', 'Events', 'Parameters', 'OperationalDefinitions', 'Provenance'])
        ? 'PASS'
        : `FAIL:${wb.SheetNames.join(',')}`;

    const summary = sheetRows(wb, 'Summary');
    results.V_summary_row_count = summary.length === 3 ? 'PASS' : `FAIL:${summary.length}`;

    const test53Row = summary.find((r) => String(r.fileName).includes('test53'));
    results.V_test53_target_unknown =
      test53Row?.targetStatus === 'unknown' && test53Row?.primaryLatency_valueKind === 'unavailable'
        ? 'PASS'
        : `FAIL:${JSON.stringify({ targetStatus: test53Row?.targetStatus, kind: test53Row?.primaryLatency_valueKind })}`;

    results.V_test53_total_latency_export =
      test53Row?.totalLatency_valueKind === 'numeric' &&
      test53Row?.totalLatency_value != null &&
      Math.abs(Number(test53Row.totalLatency_value) - 24.4) < 0.15
        ? 'PASS'
        : `FAIL:${JSON.stringify({ kind: test53Row?.totalLatency_valueKind, value: test53Row?.totalLatency_value })}`;

    const test50Row = summary.find((r) => String(r.fileName).includes('test50'));
    results.V_scale_unknown_path =
      test50Row?.scaleStatus === 'unknown' && test50Row?.pathLength_unit === 'px'
        ? 'PASS'
        : `FAIL:${JSON.stringify({ scale: test50Row?.scaleStatus, unit: test50Row?.pathLength_unit })}`;

    const events = sheetRows(wb, 'Events');
    results.V_events_rows = events.length > 0 ? 'PASS' : 'FAIL:0';

    const csvDownload = page.waitForEvent('download', { timeout: 30_000 });
    await page.locator('[data-testid="export-session-csv-btn"]').click();
    const csvDl = await csvDownload;
    const csvPath = join(downloadDir, 'session.csv');
    await csvDl.saveAs(csvPath);
    const csvText = await readFile(csvPath, 'utf8');
    results.V_csv_valueKind = csvText.includes('totalLatency_valueKind') ? 'PASS' : 'FAIL:missing';
    results.V_csv_sections =
      csvText.includes('# Summary') && csvText.includes('# Events') ? 'PASS' : 'FAIL:sections';

    if (process.env.WRITE_IMPORT_FIXTURE === '1') {
      const bundleJson = await page.evaluate(() => window.__ntBuildAnalysisBundleJson?.() ?? null);
      if (!bundleJson) throw new Error('Bundle export hook unavailable');
      const fixturePath = join(ROOT, 'tests', 'fixtures', 'ms6', 'three-trial-session.neurotrack.json');
      await writeFile(fixturePath, bundleJson, 'utf8');
      results.V_write_import_fixture = 'PASS';
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await rm(downloadDir, { recursive: true, force: true });
  }

  const failures = Object.entries(results).filter(([, v]) => String(v).startsWith('FAIL'));
  console.log(JSON.stringify({ results }, null, 2));
  if (failures.length) {
    console.error('Export smoke FAIL', failures);
    process.exit(1);
  }
  console.log('Export smoke PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
