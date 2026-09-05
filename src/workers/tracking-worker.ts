/**
 * Tracking worker: two-pass demux+decode (ingest-worker pattern) + CV pipeline.
 * Each pass re-demuxes from the MP4 buffer and feeds chunks directly from mp4box
 * so sample buffers are never stored across decode sessions.
 */
import { createFile, type MP4BoxBuffer } from 'mp4box';
import { extractDecoderConfig } from './mp4-utils';
import { ctsToMicroseconds } from '../domain/timing';
import { buildBackgroundModel, sampleBackgroundFrameIndices } from '../domain/tracking/background';
import {
  buildTrackingFrameContext,
  computeTrackQuality,
  createInitialTrackerState,
  processTrackingFrame,
} from '../domain/tracking/trackPipeline';
import type {
  Observation,
  TrackingWorkerInput,
  TrackingWorkerRequest,
  TrackingWorkerResponse,
  TrackingWorkerResult,
} from '../domain/types';

function post(msg: TrackingWorkerResponse) {
  self.postMessage(msg);
}

let cancelRequested = false;
let activeJobId: string | null = null;

function frameToRgba(frame: VideoFrame, width: number, height: number): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d context');
  ctx.drawImage(frame, 0, 0);
  frame.close();
  const imageData = ctx.getImageData(0, 0, width, height);
  return new Uint8ClampedArray(imageData.data);
}

interface DecodePassOptions {
  buffer: ArrayBuffer;
  shouldCancel: () => boolean;
  onFrame: (frameIndex: number, frame: VideoFrame, width: number, height: number) => void;
}

/** One full demux + sequential decode pass — mirrors ingest-worker.ts. */
async function runDecodePass({
  buffer,
  shouldCancel,
  onFrame,
}: DecodePassOptions): Promise<{ width: number; height: number; frameCount: number }> {
  return new Promise((resolve, reject) => {
    const mp4 = createFile(true);
    let videoTrack: { id: number; nb_samples: number; codec: string } | null = null;
    let extract: ReturnType<typeof extractDecoderConfig> | null = null;
    let nbExpected = 0;
    let samplesDemuxed = 0;
    let framesDecoded = 0;
    let decodeError: string | null = null;
    let frameWidth = 0;
    let frameHeight = 0;

    mp4.onReady = async (info) => {
      try {
        if (!info.videoTracks?.length) {
          reject(new Error('No video track'));
          return;
        }

        videoTrack = info.videoTracks[0];
        nbExpected = videoTrack.nb_samples;
        extract = extractDecoderConfig(mp4, videoTrack);
        frameWidth = extract.codedWidth;
        frameHeight = extract.codedHeight;

        const config = {
          codec: extract.codec,
          codedWidth: extract.codedWidth,
          codedHeight: extract.codedHeight,
          description: extract.description,
        };

        const support = await VideoDecoder.isConfigSupported(config);
        if (!support.supported) {
          reject(new Error('VideoDecoder config not supported'));
          return;
        }

        const decoder = new VideoDecoder({
          output: (frame) => {
            if (shouldCancel()) {
              frame.close();
              return;
            }
            onFrame(framesDecoded, frame, frameWidth, frameHeight);
            framesDecoded += 1;
          },
          error: (e) => {
            decodeError = e.message || String(e);
          },
        });

        decoder.configure(config);

        mp4.onSamples = (_trackId, _ref, batch) => {
          for (const sample of batch) {
            if (shouldCancel()) return;

            const chunk = new EncodedVideoChunk({
              type: sample.is_sync ? 'key' : 'delta',
              timestamp: ctsToMicroseconds(sample.cts, sample.timescale),
              duration: ctsToMicroseconds(sample.duration, sample.timescale),
              data: sample.data as BufferSource,
            });
            decoder.decode(chunk);
            samplesDemuxed += 1;
          }

          if (samplesDemuxed >= nbExpected) {
            decoder
              .flush()
              .then(() => {
                decoder.close();
                if (decodeError) {
                  reject(new Error(decodeError));
                  return;
                }
                resolve({ width: frameWidth, height: frameHeight, frameCount: framesDecoded });
              })
              .catch(reject);
          }
        };

        mp4.setExtractionOptions(videoTrack.id, null, { nbSamples: nbExpected });
        mp4.start();
      } catch (err) {
        reject(err);
      }
    };

    mp4.onError = (e) => reject(new Error(String(e)));
    const mp4Buffer = buffer as MP4BoxBuffer;
    mp4Buffer.fileStart = 0;
    mp4.appendBuffer(mp4Buffer);
    mp4.flush();
  });
}

async function runTrackingJob(
  jobId: string,
  buffer: ArrayBuffer,
  input: TrackingWorkerInput,
): Promise<TrackingWorkerResult> {
  const wallStart = performance.now();
  cancelRequested = false;
  activeJobId = jobId;

  const { timestampIndex, geometry, trialWindow, params } = input;
  const startUs = trialWindow.startTimeUs ?? timestampIndex[0]?.timeUs ?? 0;
  const endUs =
    trialWindow.endTimeUs ?? timestampIndex[timestampIndex.length - 1]?.timeUs ?? startUs;

  const bgIndices = new Set(
    sampleBackgroundFrameIndices(timestampIndex, startUs, endUs, params.backgroundSampleCount),
  );

  const shouldCancel = () => cancelRequested && activeJobId === jobId;

  post({
    type: 'progress',
    id: jobId,
    progress: { phase: 'background', framesProcessed: 0, total: bgIndices.size },
  });

  const bgFramesByIndex = new Map<number, Uint8ClampedArray>();
  let frameWidth = 0;
  let frameHeight = 0;

  await runDecodePass({
    buffer,
    shouldCancel,
    onFrame: (frameIndex, frame, width, height) => {
      frameWidth = width;
      frameHeight = height;
      if (bgIndices.has(frameIndex)) {
        bgFramesByIndex.set(frameIndex, frameToRgba(frame, width, height));
      } else {
        frame.close();
      }
    },
  });

  if (shouldCancel()) throw new Error('cancelled');

  const bgFrameList = [...bgIndices]
    .sort((a, b) => a - b)
    .map((idx) => bgFramesByIndex.get(idx))
    .filter((f): f is Uint8ClampedArray => f != null);

  if (bgFrameList.length === 0) {
    throw new Error('Background sampling produced no frames');
  }

  post({
    type: 'progress',
    id: jobId,
    progress: { phase: 'background', framesProcessed: bgFrameList.length, total: bgIndices.size },
  });

  const background = buildBackgroundModel(bgFrameList, frameWidth, frameHeight);
  const frameCtx = buildTrackingFrameContext(
    frameWidth,
    frameHeight,
    background,
    geometry,
    trialWindow,
    params,
  );

  const observations: Observation[] = [];
  let state = createInitialTrackerState();

  await runDecodePass({
    buffer,
    shouldCancel,
    onFrame: (frameIndex, frame, width, height) => {
      if (frameIndex >= timestampIndex.length) {
        frame.close();
        return;
      }

      const entry = timestampIndex[frameIndex];
      const prev = frameIndex > 0 ? timestampIndex[frameIndex - 1] : null;
      const pixels = frameToRgba(frame, width, height);
      const result = processTrackingFrame(frameCtx, state, pixels, entry, prev);
      observations.push(result.observation);
      state = result.state;

      if (observations.length % 200 === 0 || observations.length === timestampIndex.length) {
        post({
          type: 'progress',
          id: jobId,
          progress: {
            phase: 'tracking',
            framesProcessed: observations.length,
            total: timestampIndex.length,
          },
        });
      }
    },
  });

  if (observations.length < timestampIndex.length) {
    while (observations.length < timestampIndex.length) {
      const entry = timestampIndex[observations.length];
      observations.push({
        timeUs: entry.timeUs,
        frameIndex: entry.frameIndex,
        bodyXY: null,
        noseXY: null,
        confidence: 0,
        observed: entry.timeUs < startUs ? 'absent_pre_trial' : 'lost',
        origin: 'auto',
        qualityFlags: null,
      });
    }
  }

  if (shouldCancel()) throw new Error('cancelled');

  const quality = computeTrackQuality(observations, params);

  return {
    observations,
    quality,
    wallClockMs: performance.now() - wallStart,
  };
}

self.onmessage = async (ev: MessageEvent<TrackingWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    if (activeJobId === msg.id) cancelRequested = true;
    return;
  }

  if (msg.type === 'track') {
    try {
      const result = await runTrackingJob(msg.id, msg.buffer, msg.input);
      post({ type: 'done', id: msg.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'cancelled') {
        post({ type: 'cancelled', id: msg.id });
      } else {
        post({ type: 'error', id: msg.id, error: message });
      }
    } finally {
      activeJobId = null;
      cancelRequested = false;
    }
  }
};

export {};
