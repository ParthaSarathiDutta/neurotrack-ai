import { describe, expect, it } from 'vitest';
import { checkTemplateDiscrepancy } from '../src/services/templateService';

/** Rough platform measurements from offline calibration validation (not filename branching). */
const TEST50_ROUGH = { center: { x: 329, y: 242 }, radius: 204 };
const TEST51_ROUGH = { center: { x: 284, y: 244 }, radius: 218 };
const TEST53_ROUGH = { center: { x: 329, y: 241 }, radius: 204 };

describe('templateService', () => {
  it('allows same-rig template transfer (similar rough platforms)', () => {
    expect(checkTemplateDiscrepancy(TEST50_ROUGH, TEST53_ROUGH)).toBeNull();
  });

  it('warns on cross-rig template transfer (different center/radius)', () => {
    const warning = checkTemplateDiscrepancy(TEST50_ROUGH, TEST51_ROUGH);
    expect(warning).toMatch(/different/i);
  });

  it('warns in both directions for cross-rig transfer', () => {
    expect(checkTemplateDiscrepancy(TEST51_ROUGH, TEST50_ROUGH)).toMatch(/different/i);
  });
});
