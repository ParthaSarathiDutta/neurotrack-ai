import { detectMazeFromFrames, detectRoughPlatform } from '../domain/calibration/detectMaze';
import { medianGrayscaleFrame } from '../domain/calibration/otsu';
import type { Geometry, TrialRecord } from '../domain/types';
import { getFramePixels, initFrameDecoder } from './frameService';
import { captureFrameViaVideo, getVideoBlobUrl } from './videoCaptureService';

export interface CalibrationResult {
  success: boolean;
  geometry: Partial<Geometry>;
  roughCenter: { x: number; y: number } | null;
  roughRadius: number | null;
  error: string | null;
}

async function getReferenceFrames(
  trial: TrialRecord,
  width: number,
  height: number,
): Promise<Uint8ClampedArray[]> {
  // Pre-trial segment is frozen — one worker-decoded frame is sufficient
  await initFrameDecoder(trial.fingerprint);
  try {
    const { data } = await getFramePixels(0);
    return [data];
  } catch {
    const url = await getVideoBlobUrl(trial.fingerprint);
    const entry = trial.timestampIndex[0];
    const data = await captureFrameViaVideo(url, entry.timeUs, width, height);
    URL.revokeObjectURL(url);
    return [data];
  }
}

export async function runAutoCalibration(trial: TrialRecord): Promise<CalibrationResult> {
  if (!trial.metadata || trial.timestampIndex.length === 0) {
    return { success: false, geometry: {}, roughCenter: null, roughRadius: null, error: 'No metadata' };
  }

  const width = trial.metadata.codedWidth;
  const height = trial.metadata.codedHeight;
  const pixelFrames = await getReferenceFrames(trial, width, height);

  return detectMazeFromFrames(pixelFrames, width, height);
}

export async function getReferenceFrame(
  trial: TrialRecord,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const width = trial.metadata!.codedWidth;
  const height = trial.metadata!.codedHeight;
  const frames = await getReferenceFrames(trial, width, height);
  const data =
    frames.length === 1 ? frames[0] : medianGrayscaleFrame(frames, width, height);
  return { data, width, height };
}

export async function getRoughPlatformForTrial(
  trial: TrialRecord,
): Promise<{ center: { x: number; y: number }; radius: number } | null> {
  const { data, width, height } = await getReferenceFrame(trial);
  return detectRoughPlatform(data, width, height);
}
