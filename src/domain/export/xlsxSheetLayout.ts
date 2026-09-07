import type ExcelJS from 'exceljs';

export const FRAME_INDEX_NOTE =
  'Frame indices: startFrameIndex and endFrameIndex are 0-based internal decoder indices. startFrameDisplay and endFrameDisplay add 1 for human-readable frame numbers.';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9E1F2' },
};

const NOTE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF2CC' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 11,
};

const NOTE_FONT: Partial<ExcelJS.Font> = {
  italic: true,
  size: 10,
};

const HEADER_ALIGNMENT: Partial<ExcelJS.Alignment> = {
  wrapText: true,
  vertical: 'top',
};

const WRAP_ALIGNMENT: Partial<ExcelJS.Alignment> = {
  wrapText: true,
  vertical: 'top',
};

export function setColumnWidths(
  worksheet: ExcelJS.Worksheet,
  widths: number[],
): void {
  widths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
}

export function styleHeaderRow(worksheet: ExcelJS.Worksheet, rowNumber: number, columnCount: number): void {
  const row = worksheet.getRow(rowNumber);
  row.height = 36;
  for (let col = 1; col <= columnCount; col++) {
    const cell = row.getCell(col);
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = HEADER_ALIGNMENT;
  }
}

export function styleNoteRow(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  columnCount: number,
  note: string,
): void {
  worksheet.mergeCells(rowNumber, 1, rowNumber, columnCount);
  const cell = worksheet.getCell(rowNumber, 1);
  cell.value = note;
  cell.font = NOTE_FONT;
  cell.fill = NOTE_FILL;
  cell.alignment = WRAP_ALIGNMENT;
  worksheet.getRow(rowNumber).height = 42;
}

export function applyWrapToColumns(
  worksheet: ExcelJS.Worksheet,
  columnIndexes: number[],
  firstDataRow: number,
  lastRow: number,
): void {
  for (let row = firstDataRow; row <= lastRow; row++) {
    for (const col of columnIndexes) {
      const cell = worksheet.getRow(row).getCell(col);
      cell.alignment = { ...cell.alignment, ...WRAP_ALIGNMENT };
    }
  }
}

export function freezeBelowRow(worksheet: ExcelJS.Worksheet, frozenRowCount: number): void {
  worksheet.views = [
    {
      state: 'frozen',
      ySplit: frozenRowCount,
      xSplit: 0,
      topLeftCell: worksheet.getCell(frozenRowCount + 1, 1).address,
      activeCell: worksheet.getCell(frozenRowCount + 1, 1).address,
    },
  ];
}

export function applyAutoFilter(
  worksheet: ExcelJS.Worksheet,
  headerRow: number,
  lastRow: number,
  columnCount: number,
): void {
  worksheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: lastRow, column: columnCount },
  };
}

export function appendAoA(
  worksheet: ExcelJS.Worksheet,
  rows: (string | number | boolean | null)[][],
  startRow = 1,
): number {
  rows.forEach((row, rowOffset) => {
    const excelRow = worksheet.getRow(startRow + rowOffset);
    row.forEach((value, colOffset) => {
      excelRow.getCell(colOffset + 1).value = value ?? null;
    });
  });
  return startRow + rows.length - 1;
}
