import * as XLSX from 'xlsx';
import type { SessionExportData } from './sessionExport';
import { buildSessionCsvFiles } from './csvExport';

export function buildSessionXlsxArrayBuffer(data: SessionExportData): ArrayBuffer {
  const csvFiles = buildSessionCsvFiles(data);
  const wb = XLSX.utils.book_new();

  const addSheet = (name: string, csv: string) => {
    const ws = XLSX.utils.aoa_to_sheet(parseCsvToAoA(csv));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  addSheet('Summary', csvFiles.summaryCsv);
  addSheet('Events', csvFiles.eventsCsv);
  addSheet('Parameters', csvFiles.parametersCsv);
  addSheet('OperationalDefinitions', csvFiles.operationalDefinitionsCsv);
  addSheet('Provenance', csvFiles.provenanceCsv);

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
