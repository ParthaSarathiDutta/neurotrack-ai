import type { Blob, Point } from '../calibration/connectedComponents';
import {
  TRACKING_HEADING_HISTORY,
} from '../constants';
import type {
  Geometry,
  Observation,
  TimestampIndexEntry,
  TrackingParams,
  TrialWindow,
} from '../types';
import { estimatePose } from './animalPose';
import { predictPosition, selectBestBlob } from './blobSelection';
import { segmentForegroundBlobs, type PlatformRoi } from './foreground';
import { classifyMissingObservation } from './observationStatus';
import { isNearHoleOpening } from './rimGeometry';
import {
  computeTrackQuality,
  isSpeedOutlier,
  mergeQualityFlags,
} from './trackQuality';

export interface TrackerState {
  lastBody: Point | null;
  lastVelocity: Point | null;
  recentCentroids: Point[];
  recentAreas: number[];
  consecutiveMissingFrames: number;
  peakRecentArea: number;
  holeProximityStreak: number;
}

export function createInitialTrackerState(): TrackerState {
  return {
    lastBody: null,
    lastVelocity: null,
    recentCentroids: [],
    recentAreas: [],
    consecutiveMissingFrames: 0,
    peakRecentArea: 0,
    holeProximityStreak: 0,
  };
}

export interface TrackingFrameContext {
  width: number;
  height: number;
  background: Uint8ClampedArray;
  roi: PlatformRoi;
  geometry: Geometry;
  trialWindow: TrialWindow;
  params: TrackingParams;
}

function occlusionPenalty(
  blob: Blob,
  width: number,
  height: number,
  geometry: Geometry,
): number {
  let clipped = false;
  for (const p of blob.pixels) {
    if (p.x <= 2 || p.y <= 2 || p.x >= width - 3 || p.y >= height - 3) {
      clipped = true;
      break;
    }
  }
  if (clipped) return 0.7;

  const center = geometry.platformCenter;
  const radius = geometry.platformRadiusPx;
  if (center && radius && geometry.holes.length > 0) {
    const c = blob.pixels.length ? blob.centroid : null;
    if (c) {
      for (const h of geometry.holes) {
        const d = Math.hypot(c.x - h.x, c.y - h.y);
        if (d < radius * 0.08) return 0.85;
      }
    }
  }
  return 1;
}

function updateTrackerStateOnTrack(
  state: TrackerState,
  body: Point,
  area: number,
  deltaTimeUs: number,
  geometry: Geometry,
): TrackerState {
  let velocity = state.lastVelocity;
  if (state.lastBody && deltaTimeUs > 0) {
    const dt = deltaTimeUs / 1_000_000;
    velocity = {
      x: (body.x - state.lastBody.x) / dt,
      y: (body.y - state.lastBody.y) / dt,
    };
  }
  const recentCentroids = [...state.recentCentroids, body].slice(-TRACKING_HEADING_HISTORY);
  const recentAreas = [...state.recentAreas, area].slice(-TRACKING_HEADING_HISTORY);
  const peakRecentArea = Math.max(state.peakRecentArea, area);
  const holeProximityStreak = isNearHoleOpening(body, geometry)
    ? state.holeProximityStreak + 1
    : 0;

  return {
    lastBody: body,
    lastVelocity: velocity,
    recentCentroids,
    recentAreas,
    consecutiveMissingFrames: 0,
    peakRecentArea,
    holeProximityStreak,
  };
}

function updateTrackerStateOnMiss(state: TrackerState): TrackerState {
  return {
    ...state,
    consecutiveMissingFrames: state.consecutiveMissingFrames + 1,
  };
}

function makePreTrialObservation(entry: TimestampIndexEntry): Observation {
  return {
    timeUs: entry.timeUs,
    frameIndex: entry.frameIndex,
    bodyXY: null,
    noseXY: null,
    confidence: 0,
    observed: 'absent_pre_trial',
    origin: 'auto',
    qualityFlags: null,
  };
}

/** Process one frame into an Observation and updated tracker state. */
export function processTrackingFrame(
  ctx: TrackingFrameContext,
  state: TrackerState,
  frame: Uint8ClampedArray,
  entry: TimestampIndexEntry,
  prevEntry: TimestampIndexEntry | null,
): { observation: Observation; state: TrackerState } {
  const startUs = ctx.trialWindow.startTimeUs;
  if (startUs != null && entry.timeUs < startUs) {
    return { observation: makePreTrialObservation(entry), state };
  }

  const deltaTimeUs = prevEntry ? entry.timeUs - prevEntry.timeUs : 0;
  const predicted = state.lastBody
    ? predictPosition(state.lastBody, state.lastVelocity, deltaTimeUs)
    : null;

  const blobs = segmentForegroundBlobs(
    frame,
    ctx.background,
    ctx.width,
    ctx.height,
    ctx.roi,
  );

  const selection = selectBestBlob(
    blobs,
    ctx.roi.radiusPx,
    ctx.params,
    predicted,
    { lastBody: state.lastBody, geometry: ctx.geometry },
  );

  if (!selection.blob) {
    const missState = updateTrackerStateOnMiss(state);
    const missing = classifyMissingObservation(
      ctx.geometry,
      {
        lastPosition: state.lastBody,
        recentAreas: state.recentAreas,
        recentCentroids: state.recentCentroids,
      },
      {
        consecutiveMissingFrames: missState.consecutiveMissingFrames,
        peakRecentArea: state.peakRecentArea,
        holeProximityStreak: state.holeProximityStreak,
      },
    );
    return {
      observation: {
        timeUs: entry.timeUs,
        frameIndex: entry.frameIndex,
        bodyXY: null,
        noseXY: null,
        confidence: 0,
        observed: missing.observed,
        origin: 'auto',
        qualityFlags: missing.flags.length > 0 ? missing.flags : null,
      },
      state: missState,
    };
  }

  const blob = selection.blob;
  const pose = estimatePose(blob, state.recentCentroids, ctx.width, ctx.height);
  const occ = occlusionPenalty(blob, ctx.width, ctx.height, ctx.geometry);
  const confidence = Math.min(
    1,
    (0.5 * selection.sizeScore + 0.5 * selection.continuityScore) * occ,
  );

  const flags = [...pose.qualityFlags];
  if (confidence < ctx.params.lowConfidenceThreshold) {
    flags.push('low_confidence');
  }

  if (
    state.lastBody &&
    isSpeedOutlier(
      state.lastBody,
      pose.bodyXY,
      deltaTimeUs,
      ctx.params.maxPlausibleSpeedPxPerSec,
    )
  ) {
    flags.push('speed_outlier');
  }

  const newState = updateTrackerStateOnTrack(
    state,
    pose.bodyXY,
    blob.area,
    deltaTimeUs,
    ctx.geometry,
  );

  return {
    observation: {
      timeUs: entry.timeUs,
      frameIndex: entry.frameIndex,
      bodyXY: pose.bodyXY,
      noseXY: pose.noseXY,
      confidence,
      observed: 'tracked',
      origin: 'auto',
      qualityFlags: mergeQualityFlags(null, flags),
    },
    state: newState,
  };
}

/** Run full tracking pass over decoded frames (indexed by frameIndex). */
export function runTrackingPipeline(
  ctx: TrackingFrameContext,
  timestampIndex: TimestampIndexEntry[],
  getFrame: (frameIndex: number) => Uint8ClampedArray,
  onProgress?: (processed: number, total: number) => void,
  shouldCancel?: () => boolean,
): Observation[] {
  const observations: Observation[] = [];
  let state = createInitialTrackerState();
  const total = timestampIndex.length;

  for (let i = 0; i < total; i += 1) {
    if (shouldCancel?.()) break;
    const entry = timestampIndex[i];
    const prev = i > 0 ? timestampIndex[i - 1] : null;
    const frame = getFrame(entry.frameIndex);
    const result = processTrackingFrame(ctx, state, frame, entry, prev);
    observations.push(result.observation);
    state = result.state;
    if (onProgress && (i % 200 === 0 || i === total - 1)) {
      onProgress(i + 1, total);
    }
  }

  return observations;
}

export function buildTrackingFrameContext(
  width: number,
  height: number,
  background: Uint8ClampedArray,
  geometry: Geometry,
  trialWindow: TrialWindow,
  params: TrackingParams,
): TrackingFrameContext {
  const center = geometry.platformCenter;
  const radius = geometry.platformRadiusPx;
  if (!center || !radius) {
    throw new Error('Confirmed geometry with platform center and radius is required for tracking');
  }
  return {
    width,
    height,
    background,
    roi: { center, radiusPx: radius },
    geometry,
    trialWindow,
    params,
  };
}

export { computeTrackQuality };
