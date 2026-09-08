import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHoleVisitTimelineModel } from '../src/domain/visualization/holeVisitTimeline';
import {
  buildTimelineXTicks,
  censorRegionLabelLayout,
  escapeMarkerDisplayOffsets,
  timelineXTicksOverlap,
} from '../src/domain/visualization/timelineLayout';
import { effectiveTrialStartUs, censorBoundaryTimeUs } from '../src/domain/events/holeProximity';

const FIXTURE = join(process.cwd(), 'tests/fixtures/ms6/three-trial-session.neurotrack.json');
const PLOT_LEFT = 54;
const RIGHT_PAD = 20;
const CHART_WIDTH = 680;

function timelineModelForTrial(name: string) {
  const bundle = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const trial = bundle.trials.find((t: { trial: { fileName: string } }) =>
    t.trial.fileName.includes(name),
  )!.trial;
  const start = effectiveTrialStartUs(trial.trialWindow)!;
  const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
  return buildHoleVisitTimelineModel(
    trial.events.events,
    start,
    censor,
    trial.trialWindow.startTimeUs,
  );
}

function layoutContext(durationSec: number) {
  const plotWidth = CHART_WIDTH - PLOT_LEFT - RIGHT_PAD;
  const xForSec = (sec: number) => PLOT_LEFT + (sec / durationSec) * plotWidth;
  return { plotWidth, xForSec };
}

describe('hole-visit timeline layout', () => {
  it('test50: collapses near-coincident 180 s step tick into trial-end tick', () => {
    const model = timelineModelForTrial('test50');
    const ticks = buildTimelineXTicks(model.trialDurationSec);
    expect(ticks.filter((t) => t >= 179.5)).toHaveLength(1);
    expect(ticks[ticks.length - 1]).toBeCloseTo(180.033333, 3);
    expect(ticks).not.toContain(180);
  });

  it('test50: x-axis tick labels do not overlap at desktop width', () => {
    const model = timelineModelForTrial('test50');
    const ticks = buildTimelineXTicks(model.trialDurationSec);
    const { plotWidth } = layoutContext(model.trialDurationSec);
    expect(
      timelineXTicksOverlap(
        ticks,
        model.trialDurationSec,
        PLOT_LEFT,
        plotWidth,
        CHART_WIDTH,
        RIGHT_PAD,
      ),
    ).toBe(false);
  });

  it('test51 and test53: x-axis ticks remain legible', () => {
    for (const name of ['test51', 'test53']) {
      const model = timelineModelForTrial(name);
      const ticks = buildTimelineXTicks(model.trialDurationSec);
      const { plotWidth } = layoutContext(model.trialDurationSec);
      expect(
        timelineXTicksOverlap(
          ticks,
          model.trialDurationSec,
          PLOT_LEFT,
          plotWidth,
          CHART_WIDTH,
          RIGHT_PAD,
        ),
      ).toBe(false);
    }
  });

  it('censor label anchors inside the svg right edge for long trials', () => {
    const model = timelineModelForTrial('test50');
    const { xForSec } = layoutContext(model.trialDurationSec);
    const censorX = xForSec(model.censorSec);
    const label = censorRegionLabelLayout(censorX, CHART_WIDTH, RIGHT_PAD);
    expect(label.textAnchor).toBe('end');
    expect(label.x).toBeLessThanOrEqual(CHART_WIDTH - RIGHT_PAD);
    expect(label.x).toBeGreaterThan(PLOT_LEFT);
  });

  it('offsets coincident escape marker glyphs without changing event times', () => {
    const { xForSec } = layoutContext(25);
    const secs = [24.4, 25.2];
    const offsets = escapeMarkerDisplayOffsets(secs, xForSec);
    const xs = secs.map((s, i) => xForSec(s) + offsets[i]!);
    expect(xs[0]).not.toBeCloseTo(xs[1]!, 0);
    expect(offsets.every((o) => o <= 0)).toBe(true);
  });
});
