import { describe, expect, it } from 'vitest';
import { computeContentFingerprint, fingerprintPrefix } from '../src/domain/fingerprint';

describe('fingerprint', () => {
  it('produces stable SHA-256 hex for identical content', async () => {
    const blob = new Blob(['same-bytes'], { type: 'video/mp4' });
    const a = await computeContentFingerprint(blob);
    const b = await computeContentFingerprint(blob);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs for different content', async () => {
    const a = await computeContentFingerprint(new Blob(['a']));
    const b = await computeContentFingerprint(new Blob(['b']));
    expect(a).not.toBe(b);
  });

  it('prefix helper truncates for display', async () => {
    const fp = await computeContentFingerprint(new Blob(['x']));
    expect(fingerprintPrefix(fp, 8)).toBe(fp.slice(0, 8));
  });
});
