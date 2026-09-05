/**
 * MP4 track helpers for Phase 0 spike.
 * Extract codec description and coded dimensions from stsd — never hardcoded.
 */
import { DataStream } from '../node_modules/mp4box/dist/mp4box.all.mjs';

/** @typedef {{ codec: string, description: Uint8Array, codedWidth: number, codedHeight: number, hdrSize: number, dimensionSources: Record<string, number|null> }} DecoderExtract */

/**
 * @param {import('../node_modules/mp4box/dist/mp4box.all.mjs').ISOFile} mp4
 * @param {object} track from onReady videoTracks[0]
 * @returns {DecoderExtract}
 */
export function extractDecoderConfig(mp4, track) {
  const trak = mp4.getTrackById(track.id);
  if (!trak) throw new Error(`Track ${track.id} not found`);

  const entries = trak.mdia.minf.stbl.stsd.entries;
  let description = null;
  let hdrSize = 8;
  let codecBoxType = null;

  for (const entry of entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      codecBoxType = box.type || (entry.avcC ? 'avcC' : entry.hvcC ? 'hvcC' : 'unknown');
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      hdrSize = typeof box.hdr_size === 'number' ? box.hdr_size : 8;
      const total = stream.buffer.byteLength;
      description = new Uint8Array(stream.buffer, hdrSize, total - hdrSize);
      break;
    }
  }

  if (!description) {
    throw new Error('No codec description box (avcC/hvcC/vpcC/av1C) found in stsd');
  }

  const visualEntry = entries[0];
  const codedWidth = visualEntry.width;
  const codedHeight = visualEntry.height;

  const dimensionSources = {
    stsd_visual_entry_width: visualEntry.width ?? null,
    stsd_visual_entry_height: visualEntry.height ?? null,
    track_video_width: track.video?.width ?? null,
    track_video_height: track.video?.height ?? null,
    track_track_width: track.track_width ?? null,
    track_track_height: track.track_height ?? null,
  };

  return {
    codec: track.codec,
    description,
    codedWidth,
    codedHeight,
    hdrSize,
    codecBoxType,
    dimensionSources,
  };
}

/** @param {number} cts @param {number} timescale @returns {number} microseconds */
export function ctsToMicroseconds(cts, timescale) {
  return Math.round((cts * 1_000_000) / timescale);
}

/** @param {number} cts @param {number} timescale @returns {number} seconds */
export function ctsToSeconds(cts, timescale) {
  return cts / timescale;
}
