/**
 * Build presentation timestamp index from MP4 container samples (mp4box).
 * Matches ingest-worker / buildTimestampIndex — not ffprobe r_frame_rate synthesis.
 */
import { readFileSync } from 'fs';
import { createFile } from 'mp4box';

/**
 * @param {string} videoPath
 * @returns {Promise<Array<{ timeUs: number; frameIndex: number; cts: number; timescale: number }>>}
 */
export async function extractMp4TimestampIndex(videoPath) {
  const { buildTimestampIndex } = await import(
    new URL('../../src/domain/timing.ts', import.meta.url).href
  );

  return new Promise((resolve, reject) => {
    const buf = readFileSync(videoPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const mp4 = createFile(true);
    const samples = [];
    let track;

    mp4.onReady = (info) => {
      track = info.videoTracks[0];
      if (!track) {
        reject(new Error(`No video track in ${videoPath}`));
        return;
      }
      mp4.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
      mp4.onSamples = (_id, _ref, batch) => {
        for (const s of batch) {
          samples.push({ cts: s.cts, timescale: s.timescale });
        }
        if (samples.length >= track.nb_samples) {
          resolve(buildTimestampIndex(samples));
        }
      };
      mp4.start();
    };

    mp4.onError = reject;
    const b = ab;
    b.fileStart = 0;
    mp4.appendBuffer(b);
    mp4.flush();
  });
}
