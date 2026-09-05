/** Content fingerprint for video re-identification. */

export async function computeContentFingerprint(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function fingerprintPrefix(fingerprint: string, length = 12): string {
  return fingerprint.slice(0, length);
}
