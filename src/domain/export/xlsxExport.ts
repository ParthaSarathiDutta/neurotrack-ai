import * as XLSX from 'xlsx';
import type { SessionExportData } from './sessionExport';
import { buildSessionCsvFiles } from './csvExport';
import {
  FRAME_INDEX_NOTE,
  applyDefaultTableLayout,
  applyEventsSheetLayout,
  applyResultsSheetLayout,
  applySummarySheetLayout,
} from './xlsxSheetLayout';

export const XLSX_SHEET_ORDER = [
  'Results',
  'Summary',
  'Events',
  'Parameters',
  'OperationalDefinitions',
  'Provenance',
] as const;

export function buildSessionXlsxArrayBuffer(data: SessionExportData): ArrayBuffer {
  const csvFiles = buildSessionCsvFiles(data);
  const wb = XLSX.utils.book_new();

  const resultsWs = XLSX.utils.json_to_sheet(data.resultsObjects);
  applyResultsSheetLayout(resultsWs);
  XLSX.utils.book_append_sheet(wb, resultsWs, 'Results');

  const summaryWs = XLSX.utils.aoa_to_sheet(parseCsvToAoA(csvFiles.summaryCsv));
  applySummarySheetLayout(summaryWs);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  const eventsAoA = parseCsvToAoA(csvFiles.eventsCsv);
  const eventsWs = XLSX.utils.aoa_to_sheet([[FRAME_INDEX_NOTE], ...eventsAoA]);
  applyEventsSheetLayout(eventsWs, 1);
  XLSX.utils.book_append_sheet(wb, eventsWs, 'Events');

  const parametersWs = XLSX.utils.aoa_to_sheet(parseCsvToAoA(csvFiles.parametersCsv));
  applyDefaultTableLayout(parametersWs);
  XLSX.utils.book_append_sheet(wb, parametersWs, 'Parameters');

  const opDefsWs = XLSX.utils.aoa_to_sheet(parseCsvToAoA(csvFiles.operationalDefinitionsCsv));
  applyDefaultTableLayout(opDefsWs);
  XLSX.utils.book_append_sheet(wb, opDefsWs, 'OperationalDefinitions');

  const provenanceWs = XLSX.utils.aoa_to_sheet(parseCsvToAoA(csvFiles.provenanceCsv));
  applyDefaultTableLayout(provenanceWs);
  XLSX.utils.book_append_sheet(wb, provenanceWs, 'Provenance');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

function parseCsvToAoA(csv: string): (string | number | boolean | null)[][] {
  if (!csv.trim()) return [[]];
  const wb = XLSX.read(csv, { type: 'string' });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as (string | number | boolean | null)[][];
}

export function getXlsxSheetNames(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  return wb.SheetNames;
}

export function readXlsxSheetRows(
  buffer: ArrayBuffer,
  sheetName: string,
  options?: { headerRowIndex?: number },
): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const jsonOptions: XLSX.Sheet2JSONOpts = { defval: null };
  if (options?.headerRowIndex != null) {
    jsonOptions.range = options.headerRowIndex;
  }
  return XLSX.utils.sheet_to_json(ws, jsonOptions) as Record<string, unknown>[];
}

export function readEventsSheetRows(buffer: ArrayBuffer): Record<string, unknown>[] {
  return readXlsxSheetRows(buffer, 'Events', { headerRowIndex: 1 });
}
