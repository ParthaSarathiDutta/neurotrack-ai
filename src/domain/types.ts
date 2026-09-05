/** Shared domain types — aligned with specs/constitution.md data model contracts. */

export type TrialWindowSource = 'auto' | 'manual';

export interface Hole {
  id: number;
  x: number;
  y: number;
  source: 'detected' | 'model' | 'manual';
  confidence: number | null;
}

export type CalibrationConfidence = 'high' | 'low' | 'failed';

export interface GeometryDetectionMeta {
  holeCandidateCount: number | null;
  /** Max per-hole slot-alignment residual (px). */
  ringFitResidualPx: number | null;
  medianSlotResidualPx: number | null;
  rmsSlotResidualPx: number | null;
  circleFitResidualPx: number | null;
  detectedHoleCount: number | null;
  modeledHoleCount: number | null;
  confidence: CalibrationConfidence | null;
  confidenceReasons: string[] | null;
  platformEdgeSampleCount: number | null;
}

export interface Geometry {
  platformCenter: { x: number; y: number } | null;
  platformRadiusPx: number | null;
  holes: Hole[];
  targetHoleId: number | null;
  proposedTargetHoleId: number | null;
  targetHoleConfirmedAt: string | null;
  pxPerCm: number | null;
  diameterCm: number | null;
  ringRotationDeg: number | null;
  source: 'auto' | 'manual' | 'template' | null;
  templateSourceTrialId: string | null;
  confirmedAt: string | null;
  /** Set when user explicitly acknowledges reviewing a low-confidence auto calibration. */
  calibrationReviewAcknowledgedAt: string | null;
  detection: GeometryDetectionMeta | null;
}

export interface TrialWindow {
  startTimeUs: number | null;
  endTimeUs: number | null;
  cutoffSeconds: number | null;
  source: TrialWindowSource;
  proposedStartTimeUs: number | null;
  proposedEndTimeUs: number | null;
  confirmedAt: string | null;
  motionOnsetConfidence: number | null;
  /** Set when automatic onset detection fails — shown in UI; cleared on success. */
  detectionFailureReason: string | null;
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

export interface FrameWorkerInitMessage {
  type: 'init';
  id: string;
  buffer: ArrayBuffer;
  fileName: string;
}

export interface FrameWorkerGetFrameMessage {
  type: 'getFrame';
  id: string;
  frameIndex: number;
}

export interface FrameWorkerGetFramesMessage {
  type: 'getFrames';
  id: string;
  frameIndices: number[];
}

export type FrameWorkerRequest =
  | FrameWorkerInitMessage
  | FrameWorkerGetFrameMessage
  | FrameWorkerGetFramesMessage;

export interface FrameWorkerFrameResult {
  frameIndex: number;
  width: number;
  height: number;
  /** RGBA pixel data */
  data: ArrayBuffer;
}

export interface FrameWorkerResponse {
  type: 'ready' | 'frame' | 'frames' | 'error';
  id: string;
  width?: number;
  height?: number;
  frame?: FrameWorkerFrameResult;
  frames?: FrameWorkerFrameResult[];
  error?: string;
}
