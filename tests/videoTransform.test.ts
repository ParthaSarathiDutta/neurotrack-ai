import { describe, expect, it } from 'vitest';
import {
  videoToDisplay,
  displayToVideo,
  stepFrameIndex,
  computeLetterboxedContentRect,
  nearestIndexEntry,
  findByFrameIndex,
  indexEntriesAtTimeUs,
} from '../src/domain/videoTransform';
import type { Observation } from '../src/domain/types';

describe('videoTransform', () => {
  const box = {
    displayWidth: 320,
    displayHeight: 240,
    videoWidth: 640,
    videoHeight: 480,
  };

  it('maps video to display coordinates when aspect ratios match', () => {
    const p = videoToDisplay({ x: 640, y: 480 }, box);
    expect(p.x).toBe(320);
    expect(p.y).toBe(240);
  });

  it('accounts for letterboxing when display is wider than video', () => {
    const wideBox = { displayWidth: 400, displayHeight: 240, videoWidth: 640, videoHeight: 480 };
    const rect = computeLetterboxedContentRect(wideBox);
    expect(rect.offsetX).toBeGreaterThan(0);
    const p = videoToDisplay({ x: 0, y: 0 }, wideBox);
    expect(p.x).toBe(rect.offsetX);
    expect(p.y).toBe(0);
  });

  it('round-trips display to video with letterboxing', () => {
    const wideBox = { displayWidth: 400, displayHeight: 240, videoWidth: 640, videoHeight: 480 };
    const original = { x: 100, y: 200 };
    const display = videoToDisplay(original, wideBox);
    const back = displayToVideo(display, wideBox);
    expect(back.x).toBeCloseTo(original.x, 5);
    expect(back.y).toBeCloseTo(original.y, 5);
  });

  it('steps frame index with clamping', () => {
    expect(stepFrameIndex(5, 1, 10)).toBe(6);
    expect(stepFrameIndex(0, -1, 10)).toBe(0);
    expect(stepFrameIndex(10, 1, 10)).toBe(10);
  });

  it('uses timestamp-index frame indices without assuming integer fps', () => {
    const frameIntervalUs = Math.round(1_000_000 / (15000 / 1001));
    const timestampIndex = [
      { timeUs: 0, frameIndex: 0, cts: 0, timescale: 15000 },
      { timeUs: frameIntervalUs, frameIndex: 1, cts: 1001, timescale: 15000 },
      { timeUs: frameIntervalUs * 2, frameIndex: 2, cts: 2002, timescale: 15000 },
    ];
    const stepDeltaUs = timestampIndex[2].timeUs - timestampIndex[1].timeUs;
    expect(stepDeltaUs).toBe(frameIntervalUs);
    expect(stepFrameIndex(timestampIndex[1].frameIndex, 1, 5538)).toBe(2);
  });

  it('nearestIndexEntry tie-breaks duplicate timeUs by lowest frameIndex', () => {
    const index = [
      { timeUs: 7_066_667, frameIndex: 209, cts: 108544, timescale: 15360 },
      { timeUs: 7_066_667, frameIndex: 210, cts: 108544, timescale: 15360 },
    ];
    expect(nearestIndexEntry(index, 7_066_667)?.frameIndex).toBe(209);
    expect(indexEntriesAtTimeUs(index, 7_066_667)).toHaveLength(2);
    expect(
      nearestIndexEntry(index, 7_066_667, { preferredFrameIndex: 210 })?.frameIndex,
    ).toBe(210);
  });

  it('findByFrameIndex resolves observations when timeUs duplicates', () => {
    const sharedTimeUs = 7_066_667;
    const observations: Observation[] = [
      {
        timeUs: sharedTimeUs,
        frameIndex: 209,
        bodyXY: { x: 1, y: 2 },
        noseXY: null,
        confidence: 0.8,
        observed: 'tracked',
        origin: 'auto',
        qualityFlags: null,
      },
      {
        timeUs: sharedTimeUs,
        frameIndex: 210,
        bodyXY: { x: 3, y: 4 },
        noseXY: null,
        confidence: 0.7,
        observed: 'tracked',
        origin: 'auto',
        qualityFlags: null,
      },
    ];
    expect(findByFrameIndex(observations, 209)?.bodyXY).toEqual({ x: 1, y: 2 });
    expect(findByFrameIndex(observations, 210)?.bodyXY).toEqual({ x: 3, y: 4 });
    expect(observations.filter((o) => o.timeUs === sharedTimeUs)).toHaveLength(2);
  });
});
