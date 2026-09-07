export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, fileName: string, mimeType = 'text/csv;charset=utf-8'): void {
  downloadBlob(new Blob([content], { type: mimeType }), fileName);
}

export function downloadArrayBuffer(buffer: ArrayBuffer, fileName: string, mimeType: string): void {
  downloadBlob(new Blob([buffer], { type: mimeType }), fileName);
}

export function exportFileBaseName(trialLabel: string, suffix: string): string {
  const safe = trialLabel.replace(/[^\w.-]+/g, '_').replace(/^_|_$/g, '') || 'trial';
  return `${safe}_${suffix}`;
}

export function sessionExportFileBaseName(exportedAt: string): string {
  const stamp = exportedAt.replace(/[:.]/g, '-');
  return `neurotrack_session_${stamp}`;
}
