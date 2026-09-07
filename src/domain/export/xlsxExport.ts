import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import type { SessionExportData } from './sessionExport';
import { buildSessionCsvFiles } from './csvExport';
import { EVENT_EXPORT_COLUMNS } from './eventsTable';
import {
  RESULTS_DISPLAY_COLUMNS,
  resultsDisplayHeaders,
  resultsRowToDisplayValues,
} from './resultsDisplayColumns';
import {
  FRAME_INDEX_NOTE,
  appendAoA,
  applyAutoFilter,
  applyWrapToColumns,
  freezeBelowRow,
  setColumnWidths,
  styleHeaderRow,
  styleNoteRow,
} from './xlsxSheetLayout';

export const XLSX_SHEET_ORDER = [
  'Results',
  'Summary',
  'Events',
  'Parameters',
  'OperationalDefinitions',
  'Provenance',
] as const;

export async function buildSessionXlsxArrayBuffer(data: SessionExportData): Promise<ArrayBuffer> {
  const csvFiles = buildSessionCsvFiles(data);
  const workbook = new ExcelJS.Workbook();

  addResultsWorksheet(workbook, data);
  addCsvWorksheet(workbook, 'Summary', parseCsvToAoA(csvFiles.summaryCsv));
  addEventsWorksheet(workbook, parseCsvToAoA(csvFiles.eventsCsv));
  addCsvWorksheet(workbook, 'Parameters', parseCsvToAoA(csvFiles.parametersCsv));
  addCsvWorksheet(workbook, 'OperationalDefinitions', parseCsvToAoA(csvFiles.operationalDefinitionsCsv));
  addCsvWorksheet(workbook, 'Provenance', parseCsvToAoA(csvFiles.provenanceCsv));

  const buffer = await workbook.xlsx.writeBuffer();
  return toArrayBuffer(buffer);
}

function addResultsWorksheet(workbook: ExcelJS.Workbook, data: SessionExportData): void {
  const worksheet = workbook.addWorksheet('Results');
  const headers = resultsDisplayHeaders();
  const dataRows = data.resultsObjects.map((row) => resultsRowToDisplayValues(row));
  const lastRow = appendAoA(worksheet, [headers, ...dataRows]);
  const columnCount = headers.length;

  setColumnWidths(
    worksheet,
    RESULTS_DISPLAY_COLUMNS.map((col) => col.width),
  );
  styleHeaderRow(worksheet, 1, columnCount);
  applyWrapToColumns(
    worksheet,
    RESULTS_DISPLAY_COLUMNS.map((col, index) => (col.wrap ? index + 1 : -1)).filter((index) => index > 0),
    2,
    lastRow,
  );
  freezeBelowRow(worksheet, 1);
  applyAutoFilter(worksheet, 1, lastRow, columnCount);
}

function addCsvWorksheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: (string | number | boolean | null)[][],
): void {
  if (rows.length === 0) {
    workbook.addWorksheet(name);
    return;
  }

  const worksheet = workbook.addWorksheet(name);
  const lastRow = appendAoA(worksheet, rows);
  const columnCount = rows[0]?.length ?? 1;

  setColumnWidths(worksheet, Array(columnCount).fill(name === 'Summary' ? 14 : 22));
  styleHeaderRow(worksheet, 1, columnCount);
  freezeBelowRow(worksheet, 1);
  applyAutoFilter(worksheet, 1, lastRow, columnCount);
}

function addEventsWorksheet(
  workbook: ExcelJS.Workbook,
  eventRows: (string | number | boolean | null)[][],
): void {
  const worksheet = workbook.addWorksheet('Events');
  const normalizedRows =
    eventRows.length > 0 && (eventRows[0]?.length ?? 0) > 0
      ? eventRows
      : [[...EVENT_EXPORT_COLUMNS]];
  const columnCount = normalizedRows[0]?.length ?? EVENT_EXPORT_COLUMNS.length;
  const noteRow = 1;
  const headerRow = 2;

  styleNoteRow(worksheet, noteRow, columnCount, FRAME_INDEX_NOTE);
  const lastRow = appendAoA(worksheet, normalizedRows, headerRow);

  setColumnWidths(
    worksheet,
    [
      14, 36, 22, 28, 10, 12, 18, 18, 18, 18, 16, 16, 16, 10, 12, 12, 10, 10, 14, 14, 18, 24,
    ].slice(0, columnCount),
  );
  styleHeaderRow(worksheet, headerRow, columnCount);
  freezeBelowRow(worksheet, headerRow);
  applyAutoFilter(worksheet, headerRow, lastRow, columnCount);
}

function parseCsvToAoA(csv: string): (string | number | boolean | null)[][] {
  if (!csv.trim()) return [[]];
  const wb = XLSX.read(csv, { type: 'string' });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as (string | number | boolean | null)[][];
}

function toArrayBuffer(buffer: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) return buffer;
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
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

export function readResultsDisplayRows(buffer: ArrayBuffer): Record<string, unknown>[] {
  return readXlsxSheetRows(buffer, 'Results');
}
