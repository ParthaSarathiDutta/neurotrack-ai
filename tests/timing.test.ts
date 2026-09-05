import { describe, expect, it } from 'vitest';
import {
  buildTimestampIndex,
  containerFrameRateLabel,
  ctsToMicroseconds,
  isNonIntegerFrameRate,
  medianUniqueCtsDelta,
} from '../src/domain/timing';

describe('timing', () => {
  it('converts cts to microseconds via timescale', () => {
    expect(ctsToMicroseconds(1001, 15000)).toBe(66733);
    expect(ctsToMicroseconds(2002, 15000)).toBe(133467);
  });

  it('builds timestamp index sorted by cts with frameIndex convenience', () => {
    const index = buildTimestampIndex([
      { cts: 2002, timescale: 15000 },
      { cts: 1001, timescale: 15000 },
      { cts: 3003, timescale: 15000 },
    ]);
    expect(index.map((e) => e.cts)).toEqual([1001, 2002, 3003]);
    expect(index[0].frameIndex).toBe(0);
    expect(index[0].timeUs).toBe(ctsToMicroseconds(1001, 15000));
  });

  it('derives 15000/1001 container frame rate label for test51-style ticks', () => {
    const cts = Array.from({ length: 10 }, (_, i) => 1001 * (i + 1));
    const median = medianUniqueCtsDelta(cts);
    expect(median).toBe(1001);
    const label = containerFrameRateLabel(15000, median);
    expect(label).toBe('15000/1001');
    expect(isNonIntegerFrameRate(label)).toBe(true);
  });

  it('does not use integer fps literals for 30fps-like containers', () => {
    const cts = Array.from({ length: 10 }, (_, i) => 512 * (i + 1));
    const median = medianUniqueCtsDelta(cts);
    expect(median).toBe(512);
    expect(containerFrameRateLabel(15360, median)).toBe('15360/512');
    expect(isNonIntegerFrameRate('15360/512')).toBe(false);
  });
});
