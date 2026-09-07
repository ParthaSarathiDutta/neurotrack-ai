/**
 * Frame decode worker: WebCodecs decode to RGBA pixel buffers for exact frame stepping.
 */
import { createFile, type MP4BoxBuffer } from 'mp4box';
import { extractDecoderConfig } from './mp4-utils';
import { ctsToMicroseconds } from '../domain/timing';
import type { FrameWorkerRequest, FrameWorkerResponse } from '../domain/types';

interface DecodedSample {
  cts: number;
  timescale: number;
  isSync: boolean;
  data: Uint8Array;
  duration: number;
}

function post(msg: FrameWorkerResponse, transfer?: Transferable[]) {
  if (transfer) {
    (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

/** Samples in original container/decode order — required for correct B-frame decoding. */
let samples: DecodedSample[] = [];
/** presentationOrder[frameIndex] = index into `samples` (decode order) for that presentation-order frame. */
let presentationOrder: number[] = [];
let extract: ReturnType<typeof extractDecoderConfig> | null = null;
let frameWidth = 0;
let frameHeight = 0;
let initPromise: Promise<void> | null = null;

async function initDecoder(buffer: ArrayBuffer): Promise<void> {
  samples = [];
  presentationOrder = [];
  extract = null;

  await new Promise<void>((resolve, reject) => {
    const mp4 = createFile(true);
    let videoTrack: { id: number; nb_samples: number; codec: string } | null = null;
    let nbExpected = 0;
    let demuxed = 0;

    mp4.onReady = (info) => {
      if (!info.videoTracks?.length) {
        reject(new Error('No video track'));
        return;
      }
      videoTrack = info.videoTracks[0];
      nbExpected = videoTrack.nb_samples;
      extract = extractDecoderConfig(mp4, videoTrack);
      frameWidth = extract.codedWidth;
      frameHeight = extract.codedHeight;

      mp4.onSamples = (_id, _ref, batch) => {
        for (const sample of batch) {
          const raw = sample.data as Uint8Array;
          const copy = new Uint8Array(raw.byteLength);
          copy.set(raw);
          samples.push({
            cts: sample.cts,
            timescale: sample.timescale,
            isSync: sample.is_sync,
            data: copy,
            duration: sample.duration,
          });
          demuxed += 1;
        }
        if (demuxed >= nbExpected) resolve();
      };

      mp4.setExtractionOptions(videoTrack.id, null, { nbSamples: nbExpected });
      mp4.start();
    };

    mp4.onError = (e) => reject(new Error(String(e)));
    const mp4Buffer = buffer as MP4BoxBuffer;
    mp4Buffer.fileStart = 0;
    mp4.appendBuffer(mp4Buffer);
    mp4.flush();
  });

  // `samples` stays in decode order (required for correct B-frame reference decoding —
  // ISOBMFF stores samples in decode order; sorting here would feed the decoder frames
  // out of dependency order and corrupt output for any GOP using B-frames). Presentation
  // order (used everywhere else in the app as "frameIndex") is a separate index built
  // from cts, matching `buildTimestampIndex`'s ordering exactly.
  presentationOrder = samples
    .map((_, i) => i)
    .sort((a, b) => samples[a].cts - samples[b].cts);
}

async function decodeFrameAtIndex(frameIndex: number): Promise<{
  frameIndex: number;
  width: number;
  height: number;
  data: ArrayBuffer;
}> {
  if (!extract) throw new Error('Decoder not initialized');
  if (frameIndex < 0 || frameIndex >= presentationOrder.length) {
    throw new Error(`Frame index ${frameIndex} out of range`);
  }

  const targetIdx = presentationOrder[frameIndex];
  const targetSample = samples[targetIdx];
  const targetTimestampUs = ctsToMicroseconds(targetSample.cts, targetSample.timescale);

  // When multiple presentation-order frames share the same composition timestamp,
  // the decoder emits multiple outputs with identical frame.timestamp — pick the Nth match.
  let sameTimestampRank = 0;
  for (let fi = 0; fi < frameIndex; fi += 1) {
    const si = presentationOrder[fi];
    const ts = ctsToMicroseconds(samples[si].cts, samples[si].timescale);
    if (ts === targetTimestampUs) sameTimestampRank += 1;
  }

  // Walk backward in DECODE order (natural array index) to the nearest keyframe —
  // a keyframe always starts its GOP in decode order too, so this is safe even
  // though `targetIdx`'s decode position and presentation position can differ.
  let startIdx = targetIdx;
  while (startIdx > 0 && !samples[startIdx].isSync) startIdx -= 1;

  const config = {
    codec: extract.codec,
    codedWidth: extract.codedWidth,
    codedHeight: extract.codedHeight,
    description: extract.description,
  };

  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) throw new Error('VideoDecoder config not supported');

  const matchingFrames: VideoFrame[] = [];
  let decodeError: string | null = null;

  const decoder = new VideoDecoder({
    output: (frame) => {
      // Match by container CTS in µs. Collect all outputs at the target timestamp;
      // duplicate adjacent CTS may share one decoder output (see sameTimestampRank).
      if (frame.timestamp === targetTimestampUs) {
        matchingFrames.push(frame);
      } else {
        frame.close();
      }
    },
    error: (e) => {
      decodeError = e.message || String(e);
    },
  });

  decoder.configure(config);

  // WebCodecs may hold B-frames until later decode-order samples in the same GOP
  // are fed; stopping at targetIdx can omit the target timestamp from outputs.
  let endIdx = targetIdx;
  while (endIdx + 1 < samples.length && !samples[endIdx + 1].isSync) {
    endIdx += 1;
  }

  for (let i = startIdx; i <= endIdx; i += 1) {
    const s = samples[i];
    const chunk = new EncodedVideoChunk({
      type: s.isSync ? 'key' : 'delta',
      timestamp: ctsToMicroseconds(s.cts, s.timescale),
      duration: ctsToMicroseconds(s.duration, s.timescale),
      data: s.data.slice(),
    });
    decoder.decode(chunk);
  }

  await decoder.flush();
  decoder.close();

  if (decodeError) throw new Error(`Frame ${frameIndex}: ${decodeError}`);
  if (matchingFrames.length === 0) {
    throw new Error(
      `Failed to decode frame ${frameIndex} (target timestamp ${targetTimestampUs}us not among decoder outputs)`,
    );
  }

  const pickIndex = Math.min(sameTimestampRank, matchingFrames.length - 1);
  const capturedFrame = matchingFrames[pickIndex]!;
  for (let i = 0; i < matchingFrames.length; i += 1) {
    if (i !== pickIndex) matchingFrames[i]!.close();
  }

  const canvas = new OffscreenCanvas(frameWidth, frameHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d context');

  const frame: VideoFrame = capturedFrame;
  ctx.drawImage(frame, 0, 0);
  frame.close();

  const imageData = ctx.getImageData(0, 0, frameWidth, frameHeight);
  const copy = new Uint8ClampedArray(imageData.data);
  return {
    frameIndex,
    width: frameWidth,
    height: frameHeight,
    data: copy.buffer,
  };
}

self.onmessage = async (ev: MessageEvent<FrameWorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      initPromise = initDecoder(msg.buffer);
      await initPromise;
      post({ type: 'ready', id: msg.id, width: frameWidth, height: frameHeight });
      return;
    }

    if (initPromise) await initPromise;

    if (msg.type === 'getFrame') {
      const frame = await decodeFrameAtIndex(msg.frameIndex);
      post({ type: 'frame', id: msg.id, frame }, [frame.data]);
      return;
    }

    if (msg.type === 'getFrames') {
      const frames = [];
      const transfers: ArrayBuffer[] = [];
      for (const idx of msg.frameIndices) {
        const frame = await decodeFrameAtIndex(idx);
        frames.push(frame);
        transfers.push(frame.data);
      }
      post({ type: 'frames', id: msg.id, frames }, transfers);
    }
  } catch (err) {
    post({
      type: 'error',
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
