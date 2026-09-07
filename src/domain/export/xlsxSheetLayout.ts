import * as XLSX from 'xlsx';

export const FRAME_INDEX_NOTE =
  'Frame indices: startFrameIndex and endFrameIndex are 0-based internal decoder indices. startFrameDisplay and endFrameDisplay add 1 for human-readable frame numbers.';

export function applyWorksheetLayout(
  ws: XLSX.WorkSheet,
  options: {
    freezeRow?: number;
    columnWidths?: number[];
    autoFilter?: boolean;
  } = {},
): void {
  const ref = ws['!ref'];
  if (!ref) return;

  if (options.freezeRow != null && options.freezeRow > 0) {
    ws['!views'] = [
      {
        state: 'frozen',
        ySplit: options.freezeRow,
        topLeftCell: XLSX.utils.encode_cell({ r: options.freezeRow, c: 0 }),
        activeCell: XLSX.utils.encode_cell({ r: options.freezeRow, c: 0 }),
      },
    ];
  }

  if (options.autoFilter) {
    ws['!autofilter'] = { ref };
  }

  if (options.columnWidths?.length) {
    ws['!cols'] = options.columnWidths.map((wch) => ({ wch }));
  }
}

export function applyResultsSheetLayout(ws: XLSX.WorkSheet): void {
  applyWorksheetLayout(ws, {
    freezeRow: 1,
    autoFilter: true,
    columnWidths: [
      18, 12, 14, 12, 10, 12, 28, 44, 18, 16, 16, 16, 16, 14, 14, 14, 14, 14, 12, 12, 18, 18, 18, 18, 14, 16,
    ],
  });
}

export function applySummarySheetLayout(ws: XLSX.WorkSheet): void {
  const ref = ws['!ref'];
  const colCount = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 20;
  applyWorksheetLayout(ws, {
    freezeRow: 1,
    autoFilter: true,
    columnWidths: Array(colCount).fill(14),
  });
}

export function applyEventsSheetLayout(ws: XLSX.WorkSheet, headerRowIndex: number): void {
  applyWorksheetLayout(ws, {
    freezeRow: headerRowIndex + 1,
    autoFilter: true,
    columnWidths: [
      14, 36, 22, 28, 10, 12, 18, 18, 18, 18, 16, 16, 16, 10, 12, 12, 10, 10, 14, 14, 18, 24,
    ],
  });
}

export function applyDefaultTableLayout(ws: XLSX.WorkSheet): void {
  applyWorksheetLayout(ws, {
    freezeRow: 1,
    autoFilter: true,
    columnWidths: [22, 36, 48, 48],
  });
}
