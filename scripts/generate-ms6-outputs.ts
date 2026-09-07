#!/usr/bin/env npx tsx
/**
 * Regenerate MS-6 Checkpoint 4 committed submission outputs from the approved
 * three-trial analysis bundle. Recomputes measures (speed_interval_validity.v1)
 * without re-detecting events or altering reviewed event statuses.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSingleTrialExportData } from '../src/domain/export/sessionExport';
import { buildSessionCsvFiles } from '../src/domain/export/csvExport';
import { buildSessionXlsxArrayBuffer, getXlsxSheetNames } from '../src/domain/export/xlsxExport';
import { buildNeuroTrackBundle, serializeNeuroTrackBundle } from '../src/domain/export/bundleExport';
import { parseNeuroTrackBundleJson } from '../src/domain/export/bundleSchema';
import { measuresFromAnalysis } from '../src/domain/measures/computeMeasures';
import { resolveMeasurementObservations } from '../src/domain/trajectory/measurementObservations';
import { TOOL_VERSION } from '../src/domain/trialFactory';
import type { AnalysisParams, NeuroTrackBundle, TrialRecord } from '../src/domain/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE_BUNDLE = join(ROOT, 'tests', 'fixtures', 'ms6', 'three-trial-session.neurotrack.json');
const OUTPUTS = join(ROOT, 'outputs');
const BUNDLES_DIR = join(OUTPUTS, 'bundles');
const PUBLIC_EXAMPLE = join(ROOT, 'public', 'example');
const FIXTURE_OUT = SOURCE_BUNDLE;

const EXPECTED_CLIPS = ['test50', 'test51', 'test53'] as const;

function clipPrefix(fileName: string): string {
  const match = fileName.match(/test\d+/i);
  return match ? match[0].toLowerCase() : fileName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
}

function recomputeTrialMeasures(trial: TrialRecord, analysisParams: AnalysisParams): TrialRecord {
  if (!trial.events) return { ...trial, measures: null };
  const basis = trial.measurementBasis ?? analysisParams.measurementBasisDefault;
  const resolved = resolveMeasurementObservations(trial.track, basis);
  if (resolved.unavailable) return { ...trial, measures: null };
  const measures = measuresFromAnalysis(
    resolved.observations,
    trial.events,
    trial.geometry,
    trial.trialWindow,
    trial.timestampIndex,
  );
  return { ...trial, measures, updatedAt: new Date().toISOString() };
}

function assertSubmissionInvariants(trials: TrialRecord[]): void {
  const byClip = new Map<string, TrialRecord>();
  for (const trial of trials) {
    byClip.set(clipPrefix(trial.fileName), trial);
  }

  for (const clip of EXPECTED_CLIPS) {
    if (!byClip.has(clip)) {
      throw new Error(`Missing trial for ${clip} in source bundle`);
    }
  }

  const test53 = byClip.get('test53')!;
  const test51 = byClip.get('test51')!;
  const test50 = byClip.get('test50')!;

  const test53Escape = test53.events?.events?.find((e) => e.type === 'escape_completed');
  if (test53Escape?.status !== 'confirmed') {
    throw new Error('test53 escape_completed must remain scientist-confirmed in source bundle');
  }
  if (test53.measures?.totalLatency?.value == null || Math.abs(test53.measures.totalLatency.value - 24.4) > 0.01) {
    throw new Error(
      `test53 confirmed total latency must remain 24.40 s after recompute (got ${test53.measures?.totalLatency?.value})`,
    );
  }
  if (test53.measures?.maxSpeed?.definitionId !== 'max_speed.v2') {
    throw new Error('test53 measures must use max_speed.v2 after recompute');
  }
  if (test53.measures?.maxSpeedDiagnostic?.value == null) {
    throw new Error('test53 must retain maxSpeedDiagnostic after recompute');
  }

  if (!test51.measures?.totalLatency?.censored || test51.measures.totalLatency.flags?.includes('escape_entry_uncertain') !== true) {
    throw new Error('test51 must retain censored uncertain-entry semantics');
  }
  if (!test50.measures?.totalLatency?.censored) {
    throw new Error('test50 must retain censored incomplete semantics');
  }

  for (const trial of trials) {
    if (trial.geometry.targetHoleId != null) {
      throw new Error(`${trial.fileName}: protocol target must remain unknown (no invented target hole)`);
    }
    if (trial.geometry.pxPerCm != null) {
      throw new Error(`${trial.fileName}: physical scale must remain unknown (no invented pxPerCm)`);
    }
  }
}

function writeReadme(inventory: string[], exportedAt: string, bundlePath: string): void {
  const readme = `# NeuroTrack AI — committed submission outputs (MS-6)

Generated from the approved three-trial analysis session using the production export
serializers in \`src/domain/export/\`. Video bytes are **not** included.

## Source videos

Sample MP4s: [Salk AIRC sample data](https://github.com/salk-software/airc-takehome/tree/main/data/barnes-maze)
(\`test50.mp4\`, \`test51.mp4\`, \`test53.mp4\`). Place locally under \`data/barnes-maze/\` for
regeneration or MP4 re-link in the browser.

## Analysis source

| Item | Location |
|------|----------|
| Session bundle (canonical) | \`tests/fixtures/ms6/three-trial-session.neurotrack.json\` |
| Load-example copy | \`public/example/all-clips-session.neurotrack.json\` |
| Committed session bundle | \`${bundlePath.replace(`${ROOT}/`, '')}\` |

Pipeline: MS-1 ingest → calibration → trial window → tracking → MS-5 event detection →
scientist review (test53 \`escape_completed\` confirmed at 24.40 s). Measures recomputed
with \`speed_interval_validity.v1\` / \`max_speed.v2\` without re-detecting events.

## Tool and schema versions

| Field | Value |
|-------|-------|
| Export timestamp | ${exportedAt} |
| Tool version | ${TOOL_VERSION} |
| Bundle schema | 1.0.0 (\`neurotrack-analysis\`) |
| Speed gating | speed_interval_validity.v1 |
| Gated speed defs | mean_speed.v2, max_speed.v2 |
| Diagnostic speed defs | mean_speed_diagnostic.v1, max_speed_diagnostic.v1 |

## Target hole and physical scale

All three trials: **protocol target unknown**, **px/cm unknown**. Summary exports mark
primary latency and quadrant measures unavailable — not zero.

## Review provenance (high level)

| Clip | Escape / latency | Events |
|------|------------------|--------|
| test53 | Confirmed completion — **24.40 s** total latency | 5 events (1 confirmed escape) |
| test51 | Candidate entry uncertain — censored ≥ 44.24 s | 10 proposed investigations |
| test50 | Incomplete censored — censored ≥ 180.03 s | 60 proposed investigations |

## Output inventory

${inventory.map((line) => `- ${line}`).join('\n')}

## Regenerate

\`\`\`bash
npm run generate:ms6-outputs
npm run validate:ms6-outputs
\`\`\`

Requires the source bundle at \`tests/fixtures/ms6/three-trial-session.neurotrack.json\`.
To rebuild that bundle from local MP4s (full pipeline):

\`\`\`bash
WRITE_IMPORT_FIXTURE=1 node scripts/smoke-export-checkpoint1.mjs
npm run generate:ms6-outputs
\`\`\`

## Load in the app

Use **Load example analysis** on an empty session, or import \`bundles/all-clips-session.neurotrack.json\`.
Reports and visualizations work without MP4 bytes; re-select video via fingerprint when needed.

## Operational definitions

See the \`OperationalDefinitions\` worksheet in each \`*_report.xlsx\`, or
\`reference/occupancy-time-accounting.md\`, \`reference/speed-interval-validity.md\`,
\`reference/occupancy-display-normalization.md\`.
`;

  writeFileSync(join(OUTPUTS, 'README.md'), readme, 'utf8');
}

function main(): void {
  const raw = readFileSync(SOURCE_BUNDLE, 'utf8');
  const parsed = parseNeuroTrackBundleJson(raw);
  if (!parsed.ok) {
    throw new Error(`Invalid source bundle: ${parsed.errors.map((e) => e.message).join('; ')}`);
  }

  const exportedAt = new Date().toISOString();
  const analysisParams: AnalysisParams = {
    ...parsed.bundle.analysisParams,
    toolVersion: TOOL_VERSION,
    updatedAt: exportedAt,
  };

  const trials: TrialRecord[] = parsed.bundle.trials.map((entry) =>
    recomputeTrialMeasures(entry.trial, analysisParams),
  );

  assertSubmissionInvariants(trials);

  const selectedTrialId =
    trials.find((t) => clipPrefix(t.fileName) === 'test53')?.id ?? parsed.bundle.selectedTrialId;

  const sessionBundle: NeuroTrackBundle = buildNeuroTrackBundle(
    trials,
    analysisParams,
    selectedTrialId,
    exportedAt,
  );

  mkdirSync(OUTPUTS, { recursive: true });
  mkdirSync(BUNDLES_DIR, { recursive: true });
  mkdirSync(PUBLIC_EXAMPLE, { recursive: true });

  const inventory: string[] = [];
  const requiredSheets = ['Summary', 'Events', 'Parameters', 'OperationalDefinitions', 'Provenance'];

  for (const trial of trials) {
    const prefix = clipPrefix(trial.fileName);
    const exportData = buildSingleTrialExportData(trial, analysisParams, exportedAt);
    const csvFiles = buildSessionCsvFiles(exportData);

    const summaryPath = join(OUTPUTS, `${prefix}_summary.csv`);
    const eventsPath = join(OUTPUTS, `${prefix}_events.csv`);
    const xlsxPath = join(OUTPUTS, `${prefix}_report.xlsx`);
    const bundlePath = join(OUTPUTS, `${prefix}.neurotrack.json`);

    writeFileSync(summaryPath, csvFiles.summaryCsv, 'utf8');
    writeFileSync(eventsPath, csvFiles.eventsCsv, 'utf8');
    writeFileSync(xlsxPath, Buffer.from(buildSessionXlsxArrayBuffer(exportData)));
    writeFileSync(
      bundlePath,
      serializeNeuroTrackBundle(buildNeuroTrackBundle([trial], analysisParams, trial.id, exportedAt)),
      'utf8',
    );

    const sheets = getXlsxSheetNames(buildSessionXlsxArrayBuffer(exportData));
    for (const sheet of requiredSheets) {
      if (!sheets.includes(sheet)) {
        throw new Error(`${prefix}_report.xlsx missing sheet ${sheet}`);
      }
    }

    inventory.push(
      `${prefix}_summary.csv`,
      `${prefix}_events.csv`,
      `${prefix}_report.xlsx`,
      `${prefix}.neurotrack.json`,
    );
  }

  const sessionBundlePath = join(BUNDLES_DIR, 'all-clips-session.neurotrack.json');
  const sessionJson = serializeNeuroTrackBundle(sessionBundle);
  writeFileSync(sessionBundlePath, sessionJson, 'utf8');
  copyFileSync(sessionBundlePath, join(PUBLIC_EXAMPLE, 'all-clips-session.neurotrack.json'));
  inventory.push('bundles/all-clips-session.neurotrack.json', 'README.md');

  writeReadme(inventory, exportedAt, sessionBundlePath);

  // Keep test fixture aligned with recomputed measures for import regression tests.
  writeFileSync(FIXTURE_OUT, sessionJson, 'utf8');

  console.log('MS-6 outputs generated:');
  for (const item of inventory) {
    console.log(`  outputs/${item}`);
  }
  console.log('  public/example/all-clips-session.neurotrack.json');
  console.log(`  updated ${FIXTURE_OUT.replace(`${ROOT}/`, '')}`);
}

main();
