import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SavedXlsxFormatting {
  sheetNames: string[];
  resultsXml: string;
  eventsXml: string;
  summaryXml: string;
  stylesXml: string;
  sharedStringsXml: string;
}

export function inspectSavedXlsx(buffer: ArrayBuffer): SavedXlsxFormatting {
  const dir = mkdtempSync(join(tmpdir(), 'nt-xlsx-fmt-'));
  const path = join(dir, 'workbook.xlsx');
  writeFileSync(path, Buffer.from(buffer));

  const sheetNames = execSync(`unzip -Z1 "${path}"`, { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  const readXml = (entry: string) => {
    try {
      return execSync(`unzip -p "${path}" "${entry}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      return '';
    }
  };

  return {
    sheetNames,
    resultsXml: readXml('xl/worksheets/sheet1.xml'),
    summaryXml: readXml('xl/worksheets/sheet2.xml'),
    eventsXml: readXml('xl/worksheets/sheet3.xml'),
    stylesXml: readXml('xl/styles.xml'),
    sharedStringsXml: readXml('xl/sharedStrings.xml'),
  };
}

export function hasFrozenPane(worksheetXml: string): boolean {
  return /<pane\b/.test(worksheetXml);
}

export function hasWrapTextStyles(stylesXml: string): boolean {
  return /wrapText="1"/.test(stylesXml);
}

export function hasAutoFilter(worksheetXml: string, ref: string): boolean {
  return new RegExp(`<autoFilter ref="${ref}"`).test(worksheetXml);
}

export function hasCustomColumnWidths(worksheetXml: string): boolean {
  return /<cols>/.test(worksheetXml) && /customWidth="1"/.test(worksheetXml);
}

export function hasStyledHeaderCells(worksheetXml: string): boolean {
  return /\ss="1"/.test(worksheetXml);
}

export function hasWrappedDataCells(worksheetXml: string): boolean {
  return /\ss="2"/.test(worksheetXml);
}

export function hasHeaderFill(stylesXml: string): boolean {
  return /FFD9E1F2/i.test(stylesXml);
}
