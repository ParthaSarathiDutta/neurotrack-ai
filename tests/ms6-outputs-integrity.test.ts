import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNeuroTrackBundleJson } from '../src/domain/export/bundleSchema';
import { getXlsxSheetNames } from '../src/domain/export/xlsxExport';

const OUTPUTS = join(process.cwd(), 'outputs');
const CLIPS = ['test50', 'test51', 'test53'] as const;

const outputsPresent = existsSync(join(OUTPUTS, 'bundles', 'all-clips-session.neurotrack.json'));

describe.skipIf(!outputsPresent)('MS-6 committed outputs integrity', () => {
  it('includes all per-clip artifacts and session bundle', () => {
    for (const clip of CLIPS) {
      expect(existsSync(join(OUTPUTS, `${clip}_summary.csv`))).toBe(true);
      expect(existsSync(join(OUTPUTS, `${clip}_events.csv`))).toBe(true);
      expect(existsSync(join(OUTPUTS, `${clip}_report.xlsx`))).toBe(true);
      expect(existsSync(join(OUTPUTS, `${clip}.neurotrack.json`))).toBe(true);
    }
    expect(existsSync(join(OUTPUTS, 'README.md'))).toBe(true);
    expect(existsSync(join(OUTPUTS, 'bundles', 'all-clips-session.neurotrack.json'))).toBe(true);
  });

  it('preserves test53 confirmed 24.40 s latency in bundle and XLSX', () => {
    const bundleRaw = readFileSync(join(OUTPUTS, 'test53.neurotrack.json'), 'utf8');
    const parsed = parseNeuroTrackBundleJson(bundleRaw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const trial = parsed.bundle.trials[0]!.trial;
    expect(trial.measures?.totalLatency?.value).toBeCloseTo(24.4, 2);
    expect(trial.events?.events?.some((e) => e.type === 'escape_completed' && e.status === 'confirmed')).toBe(
      true,
    );

    const xlsxBuffer = readFileSync(join(OUTPUTS, 'test53_report.xlsx'));
    expect(getXlsxSheetNames(xlsxBuffer.buffer.slice(xlsxBuffer.byteOffset, xlsxBuffer.byteOffset + xlsxBuffer.byteLength))).toEqual(
      expect.arrayContaining(['Results', 'Summary', 'Events', 'Parameters', 'OperationalDefinitions', 'Provenance']),
    );
  });

  it('session bundle contains three trials with matching event counts', () => {
    const session = JSON.parse(
      readFileSync(join(OUTPUTS, 'bundles', 'all-clips-session.neurotrack.json'), 'utf8'),
    );
    expect(session.trials).toHaveLength(3);
    for (const clip of CLIPS) {
      const single = parseNeuroTrackBundleJson(
        readFileSync(join(OUTPUTS, `${clip}.neurotrack.json`), 'utf8'),
      );
      expect(single.ok).toBe(true);
      if (!single.ok) continue;
      const sessionEntry = session.trials.find((e: { trial: { fileName: string } }) =>
        e.trial.fileName.includes(clip),
      );
      expect(sessionEntry?.trial.events?.events?.length).toBe(
        single.bundle.trials[0]!.trial.events?.events?.length,
      );
    }
  });
});
