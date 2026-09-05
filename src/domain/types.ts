/** Shared domain types — aligned with specs/constitution.md data model contracts. */

export type TrialWindowSource = 'auto' | 'manual';

export interface TrialWindow {
  startTimeUs: number | null;
  endTimeUs: number | null;
  cutoffSeconds: number | null;
  source: TrialWindowSource;
}

export interface Geometry {
  platformCenter: { x: number; y: number } | null;
  platformRadiusPx: number | null;
  holes: Array<{ id: number; x: number; y: number }>;
  targetHoleId: number | null;
  pxPerCm: number | null;
  source: 'auto' | 'manual' | 'template' | null;
}

export interface TimestampIndexEntry {
  /** Primary temporal key — microseconds from container cts/timescale */
  timeUs: number;
  /** Convenience index for display; not authoritative */
  frameIndex: number;
  cts: number;
  timescale: number;
}

export interface VideoMetadata {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  trackTimescale: number;
  durationSec: number;
  nbSamples: number;
  decoderOutputFrames: number;
  /** Derived from container ticks — e.g. "15000/1001" for test51 */
  containerFrameRateLabel: string;
  medianUniqueCtsDelta: number | null;
  frameCountWarning: string | null;
}

export type IngestStatus = 'pending' | 'indexing' | 'ready' | 'error' | 'needs_reselect';

export interface TrialRecord {
  id: string;
  fingerprint: string;
  fileName: string;
  label: string;
  ingestStatus: IngestStatus;
  ingestError: string | null;
  videoCached: boolean;
  metadata: VideoMetadata | null;
  timestampIndex: TimestampIndexEntry[];
  trialWindow: TrialWindow;
  geometry: Geometry;
  /** Placeholders for MS-2+ */
  progress: {
    lastIngestAt: string | null;
    decodeWallClockMs: number | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisParams {
  id: 'default';
  toolVersion: string;
  updatedAt: string;
}

export interface PersistedSession {
  trials: TrialRecord[];
  selectedTrialId: string | null;
  analysisParams: AnalysisParams;
}

export interface IngestWorkerResult {
  metadata: VideoMetadata;
  timestampIndex: TimestampIndexEntry[];
  decodeWallClockMs: number;
}

export interface IngestWorkerMessage {
  type: 'ingest';
  id: string;
  buffer: ArrayBuffer;
  fileName: string;
}

export interface IngestWorkerResponse {
  type: 'done' | 'error' | 'progress';
  id: string;
  result?: IngestWorkerResult;
  error?: string;
  progress?: { phase: string; framesDecoded: number; total: number };
}
