/**
 * Phase 0 primary path: mp4box demux + WebCodecs VideoDecoder in a Worker.
 * Timestamps derive from sample cts and track timescale only — no fps constants.
 */
import { createFile } from '../node_modules/mp4box/dist/mp4box.all.mjs';
import { extractDecoderConfig, ctsToMicroseconds } from './mp4-utils.js';

/** @param {ArrayBuffer} buffer @param {string} fileName */
async function decodeVideo(buffer, fileName) {
  const wallStart = performance.now();

  /** @type {Array<{cts: number, timescale: number, sourceTimeUs: number}>} */
  const sampleMeta = [];
  /** @type {Array<{seq: number, cts: number, timescale: number, sourceTimeUs: number, decoderTimestampUs: number, deltaUs: number}>} */
  const frameRecords = [];

  let videoTrack = null;
  let extract = null;
  let nbSamplesExpected = 0;
  let samplesDemuxed = 0;
  let framesDecoded = 0;
  let decoderError = null;
  /** @type {Promise<ImageBitmap>|null} */
  let thumbnailPromise = null;

  const mp4 = createFile(true);

  const decodePromise = new Promise((resolve, reject) => {
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
            const meta = sampleMeta[framesDecoded];
            const decoderTimestampUs = frame.timestamp;
            const sourceTimeUs = meta?.sourceTimeUs ?? null;
            const deltaUs =
              sourceTimeUs != null ? decoderTimestampUs - sourceTimeUs : null;

            if (framesDecoded === Math.floor(nbSamplesExpected / 2) && !thumbnailPromise) {
              thumbnailPromise = createImageBitmap(frame);
            }

            frameRecords.push({
              seq: framesDecoded,
              cts: meta?.cts ?? null,
              timescale: meta?.timescale ?? null,
              sourceTimeUs,
              decoderTimestampUs,
              deltaUs,
            });

            frame.close();
            framesDecoded += 1;
          },
          error: (e) => {
            decoderError = e.message || String(e);
          },
        });

        decoder.configure(config);

        mp4.onSamples = (_trackId, _ref, samples) => {
          for (const sample of samples) {
            const sourceTimeUs = ctsToMicroseconds(sample.cts, sample.timescale);
            sampleMeta.push({
              cts: sample.cts,
              timescale: sample.timescale,
              sourceTimeUs,
            });

            const chunk = new EncodedVideoChunk({
              type: sample.is_sync ? 'key' : 'delta',
              timestamp: sourceTimeUs,
              duration: ctsToMicroseconds(sample.duration, sample.timescale),
              data: sample.data,
            });

            decoder.decode(chunk);
            samplesDemuxed += 1;
          }

          if (samplesDemuxed >= nbSamplesExpected) {
            decoder
              .flush()
              .then(async () => {
                const built = buildResult();
                if (thumbnailPromise) {
                  built.thumbnail = await thumbnailPromise;
                }
                resolve(built);
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

    function buildResult() {
      const sortedTimesUs = frameRecords
        .map((r) => r.decoderTimestampUs)
        .filter((t) => t != null)
        .sort((a, b) => a - b);

      const decoderIntervalsSec = [];
      for (let i = 1; i < sortedTimesUs.length; i += 1) {
        decoderIntervalsSec.push((sortedTimesUs[i] - sortedTimesUs[i - 1]) / 1_000_000);
      }

      // Authoritative timing path (D4): container cts in track timescale.
      const timescale = videoTrack.timescale;
      const ctsSorted = sampleMeta.map((s) => s.cts).sort((a, b) => a - b);
      const ctsDeltas = [];
      for (let i = 1; i < ctsSorted.length; i += 1) {
        ctsDeltas.push(ctsSorted[i] - ctsSorted[i - 1]);
      }
      const uniqueCtsSorted = [...new Set(ctsSorted)].sort((a, b) => a - b);
      const uniqueCtsDeltas = [];
      for (let i = 1; i < uniqueCtsSorted.length; i += 1) {
        uniqueCtsDeltas.push(uniqueCtsSorted[i] - uniqueCtsSorted[i - 1]);
      }
      const ctsIntervalsSec = ctsDeltas.map((d) => d / timescale);
      const uniqueCtsIntervalsSec = uniqueCtsDeltas.map((d) => d / timescale);
      const meanCtsDelta =
        uniqueCtsDeltas.length > 0
          ? uniqueCtsDeltas.reduce((a, b) => a + b, 0) / uniqueCtsDeltas.length
          : null;
      const meanIntervalSecFromCts =
        meanCtsDelta != null ? meanCtsDelta / timescale : null;
      const medianCtsDelta =
        uniqueCtsDeltas.length > 0
          ? [...uniqueCtsDeltas].sort((a, b) => a - b)[
              Math.floor(uniqueCtsDeltas.length / 2)
            ]
          : null;
      const medianIntervalSecFromCts =
        medianCtsDelta != null ? medianCtsDelta / timescale : null;
      const uniqueCtsDeltasAllSamples = [...new Set(ctsDeltas)].sort((a, b) => a - b);

      const meanIntervalSec =
        decoderIntervalsSec.length > 0
          ? decoderIntervalsSec.reduce((a, b) => a + b, 0) / decoderIntervalsSec.length
          : null;

      const medianIntervalSec =
        decoderIntervalsSec.length > 0
          ? [...decoderIntervalsSec].sort((a, b) => a - b)[
              Math.floor(decoderIntervalsSec.length / 2)
            ]
          : null;

      return {
        fileName,
        path: 'webcodecs-worker',
        success: !decoderError,
        decoderError,
        wallClockMs: performance.now() - wallStart,
        track: {
          id: videoTrack.id,
          timescale: videoTrack.timescale,
          durationTicks: videoTrack.duration,
          durationSec: videoTrack.duration / videoTrack.timescale,
          nb_samples: nbSamplesExpected,
          codec: videoTrack.codec,
        },
        extract: {
          codec: extract.codec,
          codedWidth: extract.codedWidth,
          codedHeight: extract.codedHeight,
          descriptionBytes: extract.description.byteLength,
          hdrSize: extract.hdrSize,
          codecBoxType: extract.codecBoxType,
          dimensionSources: extract.dimensionSources,
        },
        isConfigSupported: true,
        counts: {
          mp4box_nb_samples: nbSamplesExpected,
          samples_demuxed: samplesDemuxed,
          decoder_output_frames: framesDecoded,
        },
        timing: {
          presentationTimesUsFirst10: sortedTimesUs.slice(0, 10),
          presentationTimesUsLast3: sortedTimesUs.slice(-3),
          decoderIntervalsFirst10: decoderIntervalsSec.slice(0, 10),
          ctsSortedFirst10: ctsSorted.slice(0, 10),
          ctsDeltasFirst10: ctsDeltas.slice(0, 10),
          ctsIntervalsFirst10: ctsIntervalsSec.slice(0, 10),
          uniqueCtsCount: uniqueCtsSorted.length,
          uniqueCtsDeltasFirst10: uniqueCtsDeltas.slice(0, 10),
          uniqueCtsIntervalsFirst10: uniqueCtsIntervalsSec.slice(0, 10),
          uniqueCtsDeltasAllSamples,
          meanIntervalSecFromCts,
          medianIntervalSecFromCts,
          meanCtsDelta,
          medianCtsDelta,
          meanIntervalSecAllSortedCtsPairs:
            ctsDeltas.length > 0
              ? ctsDeltas.reduce((a, b) => a + b, 0) / ctsDeltas.length / timescale
              : null,
          noteDuplicateCtsSkew:
            ctsDeltas.length !== uniqueCtsDeltas.length
              ? 'Mean over all sorted cts pairs includes duplicate cts (delta=0); V2 uses unique presentation times only'
              : null,
          meanIntervalSecDecoderSorted: meanIntervalSec,
          medianIntervalSecDecoderSorted: medianIntervalSec,
          trackTimescale: videoTrack.timescale,
          calculationPath: 'cts / track.timescale (D4); intervals from sorted sample cts',
        },
        frameRecordsSample: frameRecords.slice(0, 5),
      };
    }
  });

  buffer.fileStart = 0;
  mp4.appendBuffer(buffer);
  mp4.flush();

  const result = await decodePromise;
  return result;
}

self.onmessage = async (ev) => {
  const { type, buffer, fileName, id } = ev.data;
  if (type !== 'decode') return;

  try {
    const result = await decodeVideo(buffer, fileName);
    const transfer = [];
    const payload = { type: 'done', id, result: { ...result } };
    if (result.thumbnail) {
      transfer.push(result.thumbnail);
    }
    self.postMessage(payload, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', id, error: err.message || String(err) });
  }
};
