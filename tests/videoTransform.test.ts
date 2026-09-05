import { describe, expect, it } from 'vitest';
import {
  videoToDisplay,
  displayToVideo,
  stepFrameIndex,
  computeLetterboxedContentRect,
} from '../src/domain/videoTransform';

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
});
