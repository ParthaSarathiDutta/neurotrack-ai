/**
 * Ingest worker: mp4box demux + WebCodecs decode to build metadata and timestamp index.
 * Timestamps derive from sample cts and track timescale only — no fps constants.
 */
import { createFile, type MP4BoxBuffer } from 'mp4box';
import { extractDecoderConfig } from './mp4-utils';
import {
  buildTimestampIndex,
  ctsToMicroseconds,
  containerFrameRateLabel,
  medianUniqueCtsDelta,
} from '../domain/timing';
import type { IngestWorkerMessage, IngestWorkerResponse, IngestWorkerResult } from '../domain/types';

function post(msg: IngestWorkerResponse) {
  self.postMessage(msg);
}

async function ingestVideo(
  buffer: ArrayBuffer,
  fileName: string,
  messageId: string,
): Promise<IngestWorkerResult> {
  const wallStart = performance.now();

  /** @type {Array<{cts: number, timescale: number}>} */
  const samples: Array<{ cts: number; timescale: number }> = [];
  let videoTrack: {
    id: number;
    timescale: number;
    duration: number;
    nb_samples: number;
    codec: string;
  } | null = null;
  let extract: ReturnType<typeof extractDecoderConfig> | null = null;
  let nbSamplesExpected = 0;
  let samplesDemuxed = 0;
  let framesDecoded = 0;
  let decoderError: string | null = null;

  const mp4 = createFile(true);

  const ingestPromise = new Promise<IngestWorkerResult>((resolve, reject) => {
    mp4.onReady = async (info) => {
      try {
        if (!info.videoTracks?.length) {
          reject(new Error('No video track'));
          return;
        }

        videoTrack = info.videoTracks[0];
        nbSamplesExpected = videoTrack.nb_samples;
        extract = extractDecoderConfig(mp4, videoTrack);

        const config = {
          codec: extract.codec,
          codedWidth: extract.codedWidth,
          codedHeight: extract.codedHeight,
          description: extract.description,
        };

        const support = await VideoDecoder.isConfigSupported(config);
        if (!support.supported) {
          reject(new Error(`isConfigSupported rejected for ${fileName}`));
          return;
        }

        const decoder = new VideoDecoder({
          output: (frame) => {
            frame.close();
            framesDecoded += 1;
            if (framesDecoded % 200 === 0 || framesDecoded === nbSamplesExpected) {
              post({
                type: 'progress',
                id: messageId,
                progress: {
                  phase: 'decode',
                  framesDecoded,
                  total: nbSamplesExpected,
                },
              });
            }
          },
          error: (e) => {
            decoderError = e.message || String(e);
          },
        });

        decoder.configure(config);

        mp4.onSamples = (_trackId, _ref, batch) => {
          for (const sample of batch) {
            samples.push({ cts: sample.cts, timescale: sample.timescale });

            const sourceTimeUs = ctsToMicroseconds(sample.cts, sample.timescale);
            const chunk = new EncodedVideoChunk({
              type: sample.is_sync ? 'key' : 'delta',
              timestamp: sourceTimeUs,
              duration: ctsToMicroseconds(sample.duration, sample.timescale),
              data: sample.data as BufferSource,
            });

            decoder.decode(chunk);
            samplesDemuxed += 1;
          }

          if (samplesDemuxed >= nbSamplesExpected) {
            decoder
              .flush()
              .then(() => {
                if (decoderError) {
                  reject(new Error(decoderError));
                  return;
                }
                if (!videoTrack || !extract) {
                  reject(new Error('Track metadata missing after decode'));
                  return;
                }

                const ctsValues = samples.map((s) => s.cts);
                const medianDelta = medianUniqueCtsDelta(ctsValues);
                const timestampIndex = buildTimestampIndex(samples);

                let frameCountWarning: string | null = null;
                if (framesDecoded !== nbSamplesExpected) {
                  frameCountWarning = `decoder_output(${framesDecoded}) != mp4box_nb_samples(${nbSamplesExpected})`;
                }

                resolve({
                  metadata: {
                    codec: extract.codec,
                    codedWidth: extract.codedWidth,
                    codedHeight: extract.codedHeight,
                    trackTimescale: videoTrack.timescale,
                    durationSec: videoTrack.duration / videoTrack.timescale,
                    nbSamples: nbSamplesExpected,
                    decoderOutputFrames: framesDecoded,
                    containerFrameRateLabel: containerFrameRateLabel(
                      videoTrack.timescale,
                      medianDelta,
                    ),
                    medianUniqueCtsDelta: medianDelta,
                    frameCountWarning,
                  },
                  timestampIndex,
                  decodeWallClockMs: performance.now() - wallStart,
                });
              })
              .catch(reject);
          }
        };

        mp4.setExtractionOptions(videoTrack.id, null, { nbSamples: nbSamplesExpected });
        mp4.start();
      } catch (err) {
        reject(err);
      }
    };

    mp4.onError = (e) => reject(new Error(String(e)));
  });

  const mp4Buffer = buffer as MP4BoxBuffer;
  mp4Buffer.fileStart = 0;
  mp4.appendBuffer(mp4Buffer);
  mp4.flush();

  return ingestPromise;
}

self.onmessage = async (ev: MessageEvent<IngestWorkerMessage>) => {
  const { type, buffer, fileName, id } = ev.data;
  if (type !== 'ingest') return;

  try {
    const result = await ingestVideo(buffer, fileName, id);
    post({ type: 'done', id, result });
  } catch (err) {
    post({
      type: 'error',
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
