import type { AnalysisParams } from '../types';

export interface ParameterRow {
  category: string;
  parameter: string;
  value: string | number | boolean | null;
}

function flattenObject(
  category: string,
  obj: Record<string, unknown>,
  prefix = '',
): ParameterRow[] {
  const rows: ParameterRow[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const param = prefix ? `${prefix}.${key}` : key;
    if (val != null && typeof val === 'object' && !Array.isArray(val)) {
      rows.push(...flattenObject(category, val as Record<string, unknown>, param));
    } else if (Array.isArray(val)) {
      rows.push({ category, parameter: param, value: JSON.stringify(val) });
    } else {
      rows.push({ category, parameter: param, value: val as string | number | boolean | null });
    }
  }
  return rows;
}

export function buildParameterRows(params: AnalysisParams, exportedAt: string): ParameterRow[] {
  return [
    { category: 'export', parameter: 'exportedAt', value: exportedAt },
    { category: 'export', parameter: 'toolVersion', value: params.toolVersion },
    { category: 'export', parameter: 'measurementBasisDefault', value: params.measurementBasisDefault },
    ...flattenObject('tracking', params.tracking as unknown as Record<string, unknown>),
    ...flattenObject('cleaning', params.cleaning as unknown as Record<string, unknown>),
    ...flattenObject('events', params.events as unknown as Record<string, unknown>),
    ...flattenObject('operationalDefinitions', params.operationalDefinitions as unknown as Record<string, unknown>),
  ];
}

export const PARAMETER_COLUMNS: (keyof ParameterRow)[] = ['category', 'parameter', 'value'];

export function parameterRowsToObjects(rows: ParameterRow[]): Record<string, string | number | boolean | null>[] {
  return rows.map((row) => ({ ...row }));
}
