import { describe, expect, it } from 'vitest';
import { formatHoleDisplayId, parseHoleDisplayId } from '../src/domain/holeDisplay';

describe('hole display conversion', () => {
  it('maps internal 0–19 to display 1–20', () => {
    expect(formatHoleDisplayId(0)).toBe('1');
    expect(formatHoleDisplayId(19)).toBe('20');
    expect(formatHoleDisplayId(null)).toBe('—');
  });

  it('parses display 1–20 to internal ids', () => {
    expect(parseHoleDisplayId(1)).toBe(0);
    expect(parseHoleDisplayId(20)).toBe(19);
    expect(parseHoleDisplayId(0)).toBeNull();
    expect(parseHoleDisplayId(21)).toBeNull();
  });

  it('round-trips manual event hole numbers', () => {
    for (const display of [1, 4, 20]) {
      const internal = parseHoleDisplayId(display)!;
      expect(formatHoleDisplayId(internal)).toBe(String(display));
    }
  });
});
