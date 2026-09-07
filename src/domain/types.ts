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
  /** Presentation time from container cts/timescale (microseconds). Not guaranteed unique. */
  timeUs: number;
  /** Canonical identity for this presentation-order frame — use for lookups, corrections, and observations. */
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

export type ObservedStatus = 'tracked' | 'absent_in_hole' | 'absent_pre_trial' | 'lost';
export type ObservationOrigin = 'auto' | 'interpolated' | 'smoothed' | 'manual';

export type ObservationQualityFlag =
  | 'low_confidence'
  | 'possible_occlusion'
  | 'speed_outlier'
  | 'ambiguous_head_tail'
  | 'near_hole_disappearance'
  | 'gap_interpolated'
  | 'speed_outlier_replaced'
  | 'duplicate_pts_spatial_estimate';

export interface Observation {
  /** Container presentation time — may duplicate across distinct frameIndex values. */
  timeUs: number;
  /** Canonical row identity — always use this for lookup, correction, and persistence keys. */
  frameIndex: number;
  bodyXY: { x: number; y: number } | null;
  noseXY: { x: number; y: number } | null;
  confidence: number;
  observed: ObservedStatus;
  origin: ObservationOrigin;
  qualityFlags: ObservationQualityFlag[] | null;
}

export type TrackStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TrackingParams {
  backgroundSampleCount: number;
  minBlobAreaFraction: number;
  maxBlobAreaFraction: number;
  maxPlausibleSpeedPxPerSec: number;
  lowConfidenceThreshold: number;
  toolVersion: string;
}

export interface ManualCorrection {
  frameIndex: number;
  timeUs: number;
  bodyXY: { x: number; y: number } | null;
  noseXY: { x: number; y: number } | null;
  correctedAt: string;
}

export interface CleaningParams {
  maxGapFrames: number;
  /** Maximum container-time span (µs) between bracket frames for gap fill. */
  maxGapDurationUs: number;
  smoothingWindow: number;
  outlierSpeedMultiplier: number;
  toolVersion: string;
}

export interface AppliedCleaning {
  observations: Observation[];
  params: CleaningParams;
  appliedAt: string;
  /** When true, observations are retained for audit but must not be consumed downstream. */
  stale?: boolean;
  staleReason?: string | null;
}

export interface FlaggedFrame {
  frameIndex: number;
  timeUs: number;
  reason: ObservationQualityFlag | 'lost' | 'absent_in_hole';
}

export interface TrackQuality {
  totalFrames: number;
  trackedCount: number;
  trackedFraction: number;
  lostCount: number;
  lostFraction: number;
  absentInHoleCount: number;
  longestLostGapFrames: number;
  longestLostGapUs: number;
  lowConfidenceCount: number;
  speedOutlierCount: number;
  meanConfidence: number;
  medianConfidence: number;
  overallAssessment: 'high' | 'low' | 'failed';
  assessmentReasons: string[];
  flaggedFrames: FlaggedFrame[];
}

export interface Track {
  status: TrackStatus;
  /** Raw automatic tracking output — never mutated by MS-4 correction/cleaning. */
  observations: Observation[];
  manualCorrections: ManualCorrection[];
  appliedCleaning: AppliedCleaning | null;
  quality: TrackQuality | null;
  params: TrackingParams;
  computedAt: string | null;
  error: string | null;
}

/** MS-5 — trajectory layer used for event detection and measures. */
export type MeasurementBasis = 'raw' | 'corrected' | 'cleaned';

export type EventType =
  | 'investigation'
  | 'escape_completed'
  | 'escape_incomplete_censored'
  | 'trial_censored_no_entry';

export type EventStatus = 'proposed' | 'confirmed' | 'rejected';
export type EventConfidence = 'high' | 'medium' | 'low';

export type SearchStrategyClass = 'spatial' | 'serial' | 'random' | 'unclassified';

export type PrimaryLatencyVariant =
  | 'first_target_investigation'
  | 'first_target_proximity'
  | 'first_target_investigation_confirmed_only';

export type QuadrantConventionId = 'target_centered_90' | 'fixed_orientation_90';

export interface EventDetectionParams {
  investigationNoseProximityFraction: number;
  investigationBodyProximityFraction: number;
  investigationMinDwellUs: number;
  investigationMergeGapUs: number;
  escapeProximityFraction: number;
  escapeMotionDecayRatio: number;
  escapeProximityMinSpanUs: number;
  escapeConfirmThreshold: number;
  escapeCensorThreshold: number;
  escapeCompletionAreaRatio: number;
  pixelEvidenceBudgetFrames: number;
  /** neurotrack_body_entry v1 — torso in hole; tail may remain visible. */
  bodyEntryTorsoProximityFraction: number;
  bodyEntryHoleDarkeningMin: number;
  bodyEntryPlatformAreaMaxFraction: number;
  bodyEntryTemporalMinFrames: number;
  strategyDiThreshold: number;
  strategyMaxDistinctHolesBeforeTarget: number;
  strategyMinSerialHoles: number;
  strategyMaxSerialViolations: number;
  strategyCenterCrossingThreshold: number;
  strategyNoncentralStartFlagFraction: number;
  toolVersion: string;
}

export interface OperationalDefinitionSelections {
  primaryLatencyVariant: PrimaryLatencyVariant;
  quadrantConvention: QuadrantConventionId;
  /** Required when quadrantConvention is fixed_orientation_90. */
  quadrantNorthDeg: number | null;
}

export interface BehavioralEvent {
  id: string;
  type: EventType;
  holeId: number | null;
  startFrameIndex: number;
  endFrameIndex: number;
  startTimeUs: number;
  endTimeUs: number;
  entryOnsetTimeUs: number | null;
  completionTimeUs: number | null;
  censorBoundaryTimeUs: number | null;
  origin: 'auto' | 'manual';
  status: EventStatus;
  confidence: EventConfidence | null;
  visitIndex: number | null;
  isRevisit: boolean | null;
  evidence: Record<string, number | string | boolean | null>;
  notes: string | null;
}

export interface EventAnalysis {
  events: BehavioralEvent[];
  params: EventDetectionParams;
  operationalDefinitions: OperationalDefinitionSelections;
  basisUsed: MeasurementBasis;
  computedAt: string;
  stale?: boolean;
  staleReason?: string | null;
}

export interface MeasureValue {
  value: number | null;
  unit: string;
  censored: boolean;
  unavailable: boolean;
  unavailableReason?: string | null;
  lowerBound?: number | null;
  lowerBoundUnit?: string | null;
  definitionId: string;
  definitionVersion: string;
  definitionLabel: string;
  definitionSummary: string;
  assumptions: string[];
  flags: string[];
}

export interface ErrorCountBucket {
  total: number;
  distinctHoleCount: number;
  revisitCount: number;
}

export interface ErrorCounts {
  confirmed: ErrorCountBucket;
  provisional: ErrorCountBucket;
}

export interface SearchStrategyResult {
  classification: SearchStrategyClass;
  override: SearchStrategyClass | null;
  overrideReason: string | null;
  reasoning: Record<string, number | string | boolean | null>;
  classifierVersion: string;
}

export interface MeasuresSnapshot {
  basisUsed: MeasurementBasis;
  computedAt: string;
  primaryLatency: MeasureValue;
  totalLatency: MeasureValue;
  primaryErrors: MeasureValue;
  totalErrors: MeasureValue;
  errorCounts: ErrorCounts;
  totalErrorCounts: ErrorCounts;
  pathLength: MeasureValue;
  meanSpeed: MeasureValue;
  maxSpeed: MeasureValue;
  targetQuadrantFraction: MeasureValue;
  targetQuadrantTimeSec: MeasureValue;
  searchStrategy: SearchStrategyResult;
  assumptions: string[];
}

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
  track: Track | null;
  events: EventAnalysis | null;
  measures: MeasuresSnapshot | null;
  measurementBasis: MeasurementBasis;
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
  tracking: TrackingParams;
  cleaning: CleaningParams;
  events: EventDetectionParams;
  operationalDefinitions: OperationalDefinitionSelections;
  measurementBasisDefault: MeasurementBasis;
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

export interface TrackingWorkerInput {
  fingerprint: string;
  timestampIndex: TimestampIndexEntry[];
  geometry: Geometry;
  trialWindow: TrialWindow;
  params: TrackingParams;
}

export interface TrackingWorkerTrackMessage {
  type: 'track';
  id: string;
  buffer: ArrayBuffer;
  fileName: string;
  input: TrackingWorkerInput;
}

export interface TrackingWorkerCancelMessage {
  type: 'cancel';
  id: string;
}

export type TrackingWorkerRequest = TrackingWorkerTrackMessage | TrackingWorkerCancelMessage;

export interface TrackingWorkerResult {
  observations: Observation[];
  quality: TrackQuality;
  wallClockMs: number;
}

export interface TrackingWorkerResponse {
  type: 'done' | 'error' | 'progress' | 'cancelled';
  id: string;
  result?: TrackingWorkerResult;
  error?: string;
  progress?: { phase: string; framesProcessed: number; total: number };
}
