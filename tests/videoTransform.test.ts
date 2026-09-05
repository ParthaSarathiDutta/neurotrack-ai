import { describe, expect, it } from 'vitest';
import { videoToDisplay, displayToVideo, stepFrameIndex } from '../src/domain/videoTransform';

describe('videoTransform', () => {
  const box = {
    displayWidth: 320,
    displayHeight: 240,
    videoWidth: 640,
    videoHeight: 480,
  };

  it('maps video to display coordinates', () => {
    const p = videoToDisplay({ x: 640, y: 480 }, box);
    expect(p.x).toBe(320);
    expect(p.y).toBe(240);
  });

  it('round-trips display to video', () => {
    const original = { x: 100, y: 200 };
    const display = videoToDisplay(original, box);
    const back = displayToVideo(display, box);
    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
  });

  it('steps frame index with clamping', () => {
    expect(stepFrameIndex(5, 1, 10)).toBe(6);
    expect(stepFrameIndex(0, -1, 10)).toBe(0);
    expect(stepFrameIndex(10, 1, 10)).toBe(10);
  });
});
