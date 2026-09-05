/**
 * MP4 track helpers — extract codec description and coded dimensions from stsd.
 */
import { DataStream, Endianness, type ISOFile, type SampleEntry } from 'mp4box';

export interface DecoderExtract {
  codec: string;
  description: Uint8Array;
  codedWidth: number;
  codedHeight: number;
  hdrSize: number;
  codecBoxType: string;
}

interface VideoTrackRef {
  id: number;
  codec: string;
}

function codecBox(entry: SampleEntry) {
  const e = entry as SampleEntry & {
    avcC?: { type?: string; hdr_size?: number; write(stream: DataStream): void };
    hvcC?: { type?: string; hdr_size?: number; write(stream: DataStream): void };
    vpcC?: { type?: string; hdr_size?: number; write(stream: DataStream): void };
    av1C?: { type?: string; hdr_size?: number; write(stream: DataStream): void };
    width?: number;
    height?: number;
  };
  return e;
}

export function extractDecoderConfig(mp4: ISOFile, track: VideoTrackRef): DecoderExtract {
  const trak = mp4.getTrackById(track.id);
  if (!trak) throw new Error(`Track ${track.id} not found`);

  const entries = trak.mdia.minf.stbl.stsd.entries;
  let description: Uint8Array | null = null;
  let hdrSize = 8;
  let codecBoxType = 'unknown';

  for (const rawEntry of entries) {
    const entry = codecBox(rawEntry);
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      codecBoxType =
        box.type || (entry.avcC ? 'avcC' : entry.hvcC ? 'hvcC' : entry.vpcC ? 'vpcC' : 'av1C');
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      hdrSize = typeof box.hdr_size === 'number' ? box.hdr_size : 8;
      const total = stream.buffer.byteLength;
      description = new Uint8Array(stream.buffer, hdrSize, total - hdrSize).slice();
      break;
    }
  }

  if (!description) {
    throw new Error('No codec description box (avcC/hvcC/vpcC/av1C) found in stsd');
  }

  const visualEntry = codecBox(entries[0]);
  const codedWidth = visualEntry.width ?? 0;
  const codedHeight = visualEntry.height ?? 0;

  return {
    codec: track.codec,
    description,
    codedWidth,
    codedHeight,
    hdrSize,
    codecBoxType,
  };
}
