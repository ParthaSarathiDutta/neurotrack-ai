function escapeCsvCell(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function objectsToCsv(
  rows: Record<string, string | number | boolean | null>[],
  columns?: string[],
): string {
  if (rows.length === 0) {
    return columns?.join(',') ?? '';
  }
  const cols = columns ?? Object.keys(rows[0]!);
  const header = cols.map(escapeCsvCell).join(',');
  const body = rows.map((row) => cols.map((col) => escapeCsvCell(row[col])).join(',')).join('\n');
  return `${header}\n${body}`;
}

export interface SessionCsvFiles {
  summaryCsv: string;
  eventsCsv: string;
  parametersCsv: string;
  operationalDefinitionsCsv: string;
  provenanceCsv: string;
}

export function buildSessionCsvFiles(data: {
  summaryObjects: Record<string, string | number | boolean | null>[];
  eventObjects: Record<string, string | number | boolean | null>[];
  parameterObjects: Record<string, string | number | boolean | null>[];
  operationalDefinitionObjects: Record<string, string | null>[];
  provenanceObjects: Record<string, string | number | boolean | null>[];
}): SessionCsvFiles {
  return {
    summaryCsv: objectsToCsv(data.summaryObjects),
    eventsCsv: objectsToCsv(data.eventObjects),
    parametersCsv: objectsToCsv(data.parameterObjects),
    operationalDefinitionsCsv: objectsToCsv(data.operationalDefinitionObjects),
    provenanceCsv: objectsToCsv(data.provenanceObjects),
  };
}

export function buildCombinedCsvReport(data: SessionCsvFiles): string {
  const sections = [
    ['# Summary'],
    [data.summaryCsv],
    [''],
    ['# Events'],
    [data.eventsCsv],
    [''],
    ['# Parameters'],
    [data.parametersCsv],
    [''],
    ['# OperationalDefinitions'],
    [data.operationalDefinitionsCsv],
    [''],
    ['# Provenance'],
    [data.provenanceCsv],
  ];
  return sections.flat().join('\n');
}
