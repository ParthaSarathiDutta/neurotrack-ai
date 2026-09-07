import type { MeasureValue, SearchStrategyResult } from '../types';

export type MeasureValueKind = 'numeric' | 'censored' | 'unavailable' | 'proposed' | 'categorical';

export interface EncodedMeasure {
  measureKey: string;
  definitionId: string;
  definitionVersion: string;
  definitionLabel: string;
  definitionSummary: string;
  value: number | string | null;
  valueKind: MeasureValueKind;
  unit: string;
  lowerBound: number | null;
  lowerBoundUnit: string | null;
  unavailableReason: string | null;
  assumptions: string;
  flags: string;
}

export function measureValueKind(m: MeasureValue): MeasureValueKind {
  if (m.unavailable) return 'unavailable';
  if (m.censored) {
    if (m.flags.includes('escape_completed_proposed')) return 'proposed';
    return 'censored';
  }
  return 'numeric';
}

export function encodeMeasureValue(measureKey: string, m: MeasureValue): EncodedMeasure {
  const kind = measureValueKind(m);
  return {
    measureKey,
    definitionId: m.definitionId,
    definitionVersion: m.definitionVersion,
    definitionLabel: m.definitionLabel,
    definitionSummary: m.definitionSummary,
    value: kind === 'numeric' && m.value != null ? m.value : null,
    valueKind: kind,
    unit: m.unit,
    lowerBound: m.lowerBound ?? null,
    lowerBoundUnit: m.lowerBoundUnit ?? null,
    unavailableReason: m.unavailableReason ?? null,
    assumptions: m.assumptions.join('; '),
    flags: m.flags.join('; '),
  };
}

export interface EncodedSearchStrategy {
  measureKey: 'searchStrategy';
  classification: string;
  override: string | null;
  overrideReason: string | null;
  valueKind: 'categorical';
  classifierVersion: string;
  reasoning: string;
}

export function encodeSearchStrategy(s: SearchStrategyResult): EncodedSearchStrategy {
  return {
    measureKey: 'searchStrategy',
    classification: s.classification,
    override: s.override,
    overrideReason: s.overrideReason,
    valueKind: 'categorical',
    classifierVersion: s.classifierVersion,
    reasoning: Object.entries(s.reasoning)
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
  };
}

/** Flatten encoded measures into spreadsheet-friendly column keys. */
export function flattenEncodedMeasure(prefix: string, encoded: EncodedMeasure): Record<string, string | number | null> {
  return {
    [`${prefix}_value`]: encoded.value,
    [`${prefix}_valueKind`]: encoded.valueKind,
    [`${prefix}_unit`]: encoded.unit,
    [`${prefix}_lowerBound`]: encoded.lowerBound,
    [`${prefix}_lowerBoundUnit`]: encoded.lowerBoundUnit,
    [`${prefix}_unavailableReason`]: encoded.unavailableReason,
    [`${prefix}_definitionId`]: encoded.definitionId,
    [`${prefix}_definitionVersion`]: encoded.definitionVersion,
    [`${prefix}_definitionLabel`]: encoded.definitionLabel,
    [`${prefix}_flags`]: encoded.flags,
    [`${prefix}_assumptions`]: encoded.assumptions,
  };
}

export function formatMeasureForDisplay(m: MeasureValue): string {
  if (m.unavailable) {
    return m.unavailableReason ? `Unavailable (${m.unavailableReason})` : 'Unavailable';
  }
  if (m.censored) {
    const lb =
      m.lowerBound != null
        ? ` ≥ ${m.lowerBound.toFixed(2)} ${m.lowerBoundUnit ?? m.unit}`
        : '';
    const proposed = m.flags.includes('escape_completed_proposed') ? ' (proposed — confirm to finalize)' : '';
    return `Censored${lb}${proposed}${m.flags.length ? ` [${m.flags.join(', ')}]` : ''}`;
  }
  if (m.value == null) return '—';
  return `${m.value.toFixed(2)} ${m.unit}`;
}
