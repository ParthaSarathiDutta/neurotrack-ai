#!/usr/bin/env node
/**
 * MS-6 Checkpoint 3 visualization + empty-session import UI regression.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'ms6', 'three-trial-session.neurotrack.json');
const TEST53_MP4 = join(ROOT, 'data', 'barnes-maze', 'test53.mp4');
const SCREENSHOT_DIR = join(ROOT, 'tests', 'screenshots', 'ms6-viz-refinement');

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

async function selectTrial(page, namePattern) {
  await page.getByRole('button', { name: namePattern }).click();
}

/** All matched elements must lie within the SVG viewport. */
async function textsWithinSvg(page, textSelector, svgSelector) {
  return page.evaluate(
    ({ textSel, svgSel }) => {
      const svg = document.querySelector(svgSel);
      const texts = [...document.querySelectorAll(textSel)];
      if (!svg || texts.length === 0) return { ok: false, reason: 'missing', count: texts.length };
      const sr = svg.getBoundingClientRect();
      for (const el of texts) {
        const r = el.getBoundingClientRect();
        if (
          r.left < sr.left - 3 ||
          r.right > sr.right + 3 ||
          r.top < sr.top - 3 ||
          r.bottom > sr.bottom + 3
        ) {
          return { ok: false, reason: `clipped:${el.textContent}`, count: texts.length };
        }
      }
      return { ok: true, count: texts.length };
    },
    { textSel: textSelector, svgSel: svgSelector },
  );
}

/** Y-axis title must not overlap any hole-number tick label. */
async function yAxisClearOfTickLabels(page) {
  return page.evaluate(() => {
    const ylab = document.querySelector('[data-testid="hole-timeline-y-axis-label"]');
    const ticks = [...document.querySelectorAll('[data-testid="hole-timeline-y-tick-label"]')];
    if (!ylab || ticks.length === 0) return false;
    const ry = ylab.getBoundingClientRect();
    return ticks.every((t) => {
      const rt = t.getBoundingClientRect();
      const overlap =
        ry.right > rt.left &&
        ry.left < rt.right &&
        ry.bottom > rt.top &&
        ry.top < rt.bottom;
      return !overlap;
    });
  });
}

/** Gap (px) between Y-axis title right edge and nearest tick label left edge. */
async function yAxisTitleTickGap(page) {
  return page.evaluate(() => {
    const ylab = document.querySelector('[data-testid="hole-timeline-y-axis-label"]');
    const ticks = [...document.querySelectorAll('[data-testid="hole-timeline-y-tick-label"]')];
    if (!ylab || ticks.length === 0) return null;
    const ry = ylab.getBoundingClientRect();
    const tickLeft = Math.min(...ticks.map((t) => t.getBoundingClientRect().left));
    return tickLeft - ry.right;
  });
}

async function candidateLegendGlyphCentered(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="hole-timeline-legend-candidate-glyph"]');
    if (!svg) return null;
    const line = svg.querySelector('line');
    const circle = svg.querySelector('circle');
    if (!line || !circle) return false;
    const lr = line.getBoundingClientRect();
    const cr = circle.getBoundingClientRect();
    const lineMidY = (lr.top + lr.bottom) / 2;
    const circleMidY = (cr.top + cr.bottom) / 2;
    const lineMidX = (lr.left + lr.right) / 2;
    const circleMidX = (cr.left + cr.right) / 2;
    return Math.abs(lineMidY - circleMidY) <= 2 && Math.abs(lineMidX - circleMidX) <= 2;
  });
}

async function occupancyGrayscaleSpread(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid="occupancy-cell"]')];
    if (cells.length === 0) return { ok: false, reason: 'no_cells' };
    const parse = (color) => {
      const m = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const lum = (rgb) => {
      const chan = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
    };
    const values = cells
      .map((el) => parse(getComputedStyle(el).fill))
      .filter(Boolean)
      .map(lum);
    if (values.length === 0) return { ok: false, reason: 'no_rgb' };
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { ok: max - min >= 0.12, spread: max - min, count: values.length };
  });
}

async function captureVizScreenshot(page, name) {
  const panel = page.locator('[data-testid="trial-visualizations-panel"]');
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(50);
  await panel.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
}

async function assertVizLayout(page, trialTag) {
  const yAxisOk = await yAxisClearOfTickLabels(page);
  results[`V_${trialTag}_y_axis_clear`] = yAxisOk ? 'PASS' : 'FAIL';

  const gap = await yAxisTitleTickGap(page);
  results[`V_${trialTag}_y_axis_gap_px`] =
    gap != null && gap >= 2 && gap <= 28 ? `PASS:${gap.toFixed(1)}` : `FAIL:${gap}`;

  const holeLabels = await textsWithinSvg(
    page,
    '[data-testid="occupancy-hole-label"]',
    '[data-testid="occupancy-svg"]',
  );
  results[`V_${trialTag}_occupancy_labels_in_bounds`] =
    holeLabels.ok && holeLabels.count === 20 ? 'PASS' : `FAIL:${JSON.stringify(holeLabels)}`;

  const desc = await page.locator('[data-testid="occupancy-description"]').textContent();
  results[`V_${trialTag}_occupancy_plain_language`] =
    desc && desc.includes('Darker squares indicate locations where the mouse spent more time')
      ? 'PASS'
      : `FAIL:${desc?.trim()}`;

  const norm = await page.locator('[data-testid="occupancy-heatmap"]').getAttribute('data-display-normalization');
  results[`V_${trialTag}_occupancy_display_norm`] =
    norm === 'sqrt_seconds_per_bin' ? 'PASS' : `FAIL:${norm}`;

  const scaleDetails = await page.locator('[data-testid="occupancy-scale-details"]').count();
  results[`V_${trialTag}_occupancy_scale_details`] = scaleDetails > 0 ? 'PASS' : 'FAIL';

  const gray = await occupancyGrayscaleSpread(page);
  results[`V_${trialTag}_occupancy_grayscale_spread`] =
    gray.ok ? `PASS:${gray.spread.toFixed(3)}` : `FAIL:${JSON.stringify(gray)}`;

  const legendAbsent = await page.locator('[data-testid="hole-timeline-legend-absent"]').textContent();
  results[`V_${trialTag}_dynamic_legend_note`] = legendAbsent ? 'PASS' : 'FAIL:missing';

  const censorLabel = await page.locator('[data-testid="hole-timeline-censor-label"]').count();
  results[`V_${trialTag}_censor_label`] = censorLabel > 0 ? 'PASS' : 'FAIL';
}

async function main() {
  if (!process.env.SKIP_BUILD) execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const server = await startStaticServer(DIST);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.evaluate(async () => {
      await window.__ntResetSession?.();
    });
    await page.reload();
    await waitForAppReady(page);

    results.V_empty_central_import =
      (await page.locator('[data-testid="import-bundle-empty-btn"]').count()) > 0 ? 'PASS' : 'FAIL';
    results.V_empty_ingest_import_hidden =
      (await page.locator('[data-testid="import-bundle-ingest-btn"]').count()) === 0 ? 'PASS' : 'FAIL';

    await page.locator('[data-testid="import-bundle-empty-input"]').setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="trials-heading"]')?.textContent?.includes('(3)'),
      undefined,
      { timeout: 30_000 },
    );
    results.V_ingest_import_after_load =
      (await page.locator('[data-testid="import-bundle-ingest-btn"]').count()) > 0 ? 'PASS' : 'FAIL';

    await selectTrial(page, /test53/i);
    await page.waitForSelector('[data-testid="trial-visualizations-panel"]', { timeout: 15_000 });
    results.V_test53_viz_panel = 'PASS';

    await page.locator('[data-testid="recompute-measures-btn"]').click();
    await page.waitForSelector('[data-testid="report-max-speed-diagnostic"]', { timeout: 15_000 });

    const maxSpeed = await page.locator('[data-testid="report-max-speed"]').textContent();
    results.V_test53_gated_max_speed =
      maxSpeed && !/44162|43157/.test(maxSpeed) && /\d+\.\d+ px\/s/.test(maxSpeed) ? 'PASS' : `FAIL:${maxSpeed?.trim()}`;

    const maxDiag = await page.locator('[data-testid="report-max-speed-diagnostic"]').textContent();
    results.V_test53_diagnostic_max_speed =
      maxDiag && /44162|43157/.test(maxDiag) ? 'PASS' : `FAIL:${maxDiag?.trim()}`;

    const exclusions = await page.locator('[data-testid="report-speed-exclusions"]').textContent();
    results.V_test53_speed_exclusions =
      exclusions && exclusions.includes('excluded_timestamp_compression') ? 'PASS' : `FAIL:${exclusions?.trim()}`;

    await page.waitForSelector('[data-testid="hole-visit-timeline"]', { timeout: 10_000 });
    results.V_timeline_x_axis =
      (await page.locator('[data-testid="hole-timeline-x-axis-label"]').textContent())?.includes('Elapsed time')
        ? 'PASS'
        : 'FAIL';
    results.V_timeline_y_axis =
      (await page.locator('[data-testid="hole-timeline-y-axis-label"]').textContent())?.includes('Hole number')
        ? 'PASS'
        : 'FAIL';
    results.V_timeline_legend =
      (await page.locator('[data-testid="hole-timeline-legend"]').count()) > 0 ? 'PASS' : 'FAIL';
    const invCount = await page.locator('[data-testid="hole-timeline-investigation"]').count();
    results.V_test53_timeline_investigations = invCount > 0 ? 'PASS' : `FAIL:${invCount}`;

    await assertVizLayout(page, 'test53');
    await captureVizScreenshot(page, 'test53-desktop');

    const completionEndpoint = await page.locator('[data-testid="hole-timeline-completion-endpoint"]').count();
    results.V_test53_completion_marker = completionEndpoint > 0 ? 'PASS' : 'FAIL';

    const test53LegendProposed = await page.locator('[data-testid="hole-timeline-legend-proposed_investigation"]').count();
    const test53LegendCompletion = await page.locator('[data-testid="hole-timeline-legend-confirmed_completion"]').count();
    results.V_test53_legend_present_kinds =
      test53LegendProposed > 0 && test53LegendCompletion > 0 ? 'PASS' : 'FAIL';

    const test53Absent = await page.locator('[data-testid="hole-timeline-legend-absent"]').textContent();
    results.V_test53_legend_absent_candidate =
      test53Absent && test53Absent.includes('Candidate entry') ? 'PASS' : `FAIL:${test53Absent?.trim()}`;

    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(100);
    const narrowYAxis = await yAxisClearOfTickLabels(page);
    results.V_narrow_viewport_y_axis = narrowYAxis ? 'PASS' : 'FAIL';
    const narrowGap = await yAxisTitleTickGap(page);
    results.V_narrow_viewport_y_gap =
      narrowGap != null && narrowGap >= 2 && narrowGap <= 28 ? `PASS:${narrowGap.toFixed(1)}` : `FAIL:${narrowGap}`;
    await captureVizScreenshot(page, 'test53-narrow');
    await page.setViewportSize({ width: 1280, height: 900 });

    const occCells = await page.locator('[data-testid="occupancy-cell"]').count();
    results.V_test53_occupancy_cells = occCells > 0 ? 'PASS' : `FAIL:${occCells}`;

    const latency = await page.locator('[data-testid="report-total-latency"]').textContent();
    results.V_test53_latency_preserved =
      latency && /24\.4\d s/.test(latency) ? 'PASS' : `FAIL:${latency?.trim()}`;

    await selectTrial(page, /test51/i);
    await page.waitForSelector('[data-testid="hole-visit-timeline"]', { timeout: 15_000 });
    results.V_test51_timeline = 'PASS';
    results.V_test51_occupancy =
      (await page.locator('[data-testid="occupancy-heatmap"]').count()) > 0 ? 'PASS' : 'FAIL';
    await assertVizLayout(page, 'test51');
    await captureVizScreenshot(page, 'test51-desktop');

    const candidateMarker = await page.locator('[data-testid="hole-timeline-candidate_entry"]').count();
    results.V_test51_candidate_marker = candidateMarker > 0 ? 'PASS' : 'FAIL';

    const candidateGlyphCentered = await candidateLegendGlyphCentered(page);
    results.V_test51_candidate_legend_glyph =
      candidateGlyphCentered === true ? 'PASS' : `FAIL:${candidateGlyphCentered}`;

    const test51LegendCandidate = await page.locator('[data-testid="hole-timeline-legend-candidate_entry"]').count();
    results.V_test51_legend_candidate = test51LegendCandidate > 0 ? 'PASS' : 'FAIL';

    const test51Absent = await page.locator('[data-testid="hole-timeline-legend-absent"]').textContent();
    results.V_test51_legend_absent_completion =
      test51Absent && test51Absent.includes('Confirmed completion') ? 'PASS' : `FAIL:${test51Absent?.trim()}`;

    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(100);
    results.V_test51_narrow_y_axis = (await yAxisClearOfTickLabels(page)) ? 'PASS' : 'FAIL';
    await captureVizScreenshot(page, 'test51-narrow');
    await page.setViewportSize({ width: 1280, height: 900 });

    const test51Included = await page.locator('[data-testid="occupancy-included-sec"]').textContent();
    const test51OffPlatform = await page.locator('[data-testid="occupancy-excluded-off-platform"]').textContent();
    results.V_test51_occupancy_accounting =
      test51Included && test51OffPlatform && /33\.\d+/.test(test51Included) && /11\.\d+/.test(test51OffPlatform)
        ? 'PASS'
        : `FAIL:${test51Included?.trim()} / ${test51OffPlatform?.trim()}`;
    results.V_occupancy_legend =
      (await page.locator('[data-testid="occupancy-color-legend"]').count()) > 0 ? 'PASS' : 'FAIL';
    results.V_bundle_without_video =
      (await page.locator('[data-testid="trial-visualizations-panel"]').count()) > 0 ? 'PASS' : 'FAIL';

    let hasVideo = false;
    try {
      await readFile(TEST53_MP4);
      hasVideo = true;
    } catch {
      results.V_test53_trajectory_video = 'SKIP:no_mp4';
    }

    if (hasVideo) {
      await page.locator('[data-testid="import-bundle-ingest-input"]').setInputFiles(FIXTURE);
      await page.waitForSelector('[data-testid="import-collision-dialog"]', { timeout: 10_000 });
      await page.locator('[data-testid="import-collision-cancel-btn"]').click();

      await selectTrial(page, /test53/i);
      const reselect = page.locator('[data-testid="reselect-video-btn"]');
      if ((await reselect.count()) > 0) {
        const chooserPromise = page.waitForEvent('filechooser');
        await reselect.click();
        const chooser = await chooserPromise;
        await chooser.setFiles(TEST53_MP4);
        await page.waitForSelector('[data-testid="review-view"]', { timeout: 120_000 });
      }

      if ((await page.locator('[data-testid="review-view"]').count()) > 0) {
        await page.waitForSelector('[data-testid="trajectory-overlay"]', { timeout: 15_000 });
        const visible = await page.locator('[data-testid="trajectory-overlay"]').getAttribute('data-visible');
        results.V_test53_trajectory_overlay = visible === 'true' ? 'PASS' : `FAIL:${visible}`;
        await page.locator('[data-testid="trajectory-toggle-btn"]').click();
        const hidden = await page.locator('[data-testid="trajectory-overlay"]').getAttribute('data-visible');
        results.V_trajectory_toggle = hidden === 'false' ? 'PASS' : `FAIL:${hidden}`;
      } else {
        results.V_test53_trajectory_overlay = 'SKIP:video_not_relinked';
        results.V_trajectory_toggle = 'SKIP:video_not_relinked';
      }
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }

  const failures = Object.entries(results).filter(([, v]) => String(v).startsWith('FAIL'));
  console.log(JSON.stringify({ results }, null, 2));
  if (failures.length) {
    console.error('MS-6 visualization validation FAIL', failures);
    process.exit(1);
  }
  console.log('MS-6 visualization validation PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
