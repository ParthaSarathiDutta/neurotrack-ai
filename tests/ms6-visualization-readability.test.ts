import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHoleVisitTimelineModel } from '../src/domain/visualization/holeVisitTimeline';
import { resolveTimelineLegend } from '../src/domain/visualization/timelineLegend';
import { occupancyHoleLabelPosition } from '../src/domain/visualization/occupancyGrid';
import { effectiveTrialStartUs, censorBoundaryTimeUs } from '../src/domain/events/holeProximity';

const FIXTURE = join(process.cwd(), 'tests/fixtures/ms6/three-trial-session.neurotrack.json');

function loadTrial(name: string) {
  const bundle = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return bundle.trials.find((t: { trial: { fileName: string } }) =>
    t.trial.fileName.includes(name),
  )!.trial;
}

function timelineModelForTrial(name: string) {
  const trial = loadTrial(name);
  const start = effectiveTrialStartUs(trial.trialWindow)!;
  const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
  return buildHoleVisitTimelineModel(
    trial.events.events,
    start,
    censor,
    trial.trialWindow.startTimeUs,
  );
}

describe('timeline legend resolution', () => {
  it('test53 shows only categories present in trial data', () => {
    const model = timelineModelForTrial('test53');
    const legend = resolveTimelineLegend(model, model.investigations);
    expect(legend.present).toContain('proposed_investigation');
    expect(legend.present).toContain('confirmed_completion');
    expect(legend.present).toContain('entry_onset');
    expect(legend.absent).toContain('confirmed_investigation');
    expect(legend.absent).toContain('candidate_entry');
    expect(legend.absent).toContain('manual_provenance');
  });

  it('test51 shows candidate entry but not confirmed completion', () => {
    const model = timelineModelForTrial('test51');
    const legend = resolveTimelineLegend(model, model.investigations);
    expect(legend.present).toContain('candidate_entry');
    expect(legend.absent).toContain('confirmed_completion');
  });
});

describe('occupancy hole label placement', () => {
  it('places labels inward from platform edge toward center', () => {
    const center = { x: 320, y: 240 };
    const radius = 200;
    const hole = { x: 520, y: 240 };
    const pos = occupancyHoleLabelPosition(hole.x, hole.y, center, radius, 300, 20);
    expect(pos.lx).toBeLessThan(300);
    expect(pos.cx).toBeGreaterThan(pos.lx);
  });
});
