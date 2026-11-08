import { fail, ok, type Result } from '../../core/result.ts';
import { box, concatBytes, fullBox, u16, u32, u8 } from './bytes.ts';
import type { Sample, TrackInfo } from './types.ts';

/** Samples per AAC frame. */
export const AAC_FRAME_SAMPLES = 1024;

const SAMPLE_RATES: readonly number[] = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
/** The sample entry stores the rate as 16.16, so rates above 65535 Hz are stored as 65535; the esds holds the real one. */
const MAX_SAMPLE_RATE_FIELD = 0xffff;
/** Channels for each channel configuration of the ADTS header. */
const CHANNEL_COUNTS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 8];
const ADTS_HEADER_SIZE = 7;
const ADTS_HEADER_WITH_CRC_SIZE = 9;
const ID3_HEADER_SIZE = 10;
const ID3_FOOTER_SIZE = 10;
const ID3_FOOTER_FLAG = 0x10;
const SYNCSAFE_BITS = 7;
const SYNCSAFE_MASK = 0x7f;

const NOT_AUDIO = 'This audio file is not in a format StreamDraft can read.';

export interface AacConfig {
  /** MPEG-4 audio object type (2 = AAC LC). */
  objectType: number;
  sampleRateIndex: number;
  sampleRate: number;
  channels: number;
}

/** The AAC frames of an ADTS stream, back to back without their headers. */
export interface AdtsFrames {
  config: AacConfig;
  payload: Uint8Array;
  samples: Sample[];
}

/** Length of an ID3v2 tag at the start of `data` (HLS puts a timestamp tag in front of each audio segment), or 0. */
function id3Length(data: Uint8Array): number {
  const isTag = data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33 && data.length >= ID3_HEADER_SIZE;
  if (!isTag) {
    return 0;
  }

  let size = 0;
  for (const byte of data.subarray(6, 10)) {
    size = (size << SYNCSAFE_BITS) | (byte & SYNCSAFE_MASK);
  }
  const footer = ((data[5] ?? 0) & ID3_FOOTER_FLAG) !== 0 ? ID3_FOOTER_SIZE : 0;
  return ID3_HEADER_SIZE + size + footer;
}

function isSync(data: Uint8Array, position: number): boolean {
  return data[position] === 0xff && ((data[position + 1] ?? 0) & 0xf0) === 0xf0;
}

function readConfig(data: Uint8Array, position: number): Result<AacConfig> {
  const b2 = data[position + 2] ?? 0;
  const b3 = data[position + 3] ?? 0;
  const sampleRateIndex = (b2 >> 2) & 0xf;
  const sampleRate = SAMPLE_RATES[sampleRateIndex];
  if (sampleRate === undefined) {
    return fail(NOT_AUDIO);
  }
  return ok({ objectType: (b2 >> 6) + 1, sampleRateIndex, sampleRate, channels: ((b2 & 1) << 2) | (b3 >> 6) });
}

/** Splits an ADTS stream into frames. A broken frame at the end (a cut-off segment) is dropped. */
export function parseAdts(data: Uint8Array): Result<AdtsFrames> {
  let position = id3Length(data);
  if (!isSync(data, position)) {
    return fail(NOT_AUDIO);
  }

  const config = readConfig(data, position);
  if (!config.ok) {
    return config;
  }

  const pieces: Uint8Array[] = [];
  const samples: Sample[] = [];
  while (isSync(data, position)) {
    const length = (((data[position + 3] ?? 0) & 0x3) << 11) | ((data[position + 4] ?? 0) << 3) | ((data[position + 5] ?? 0) >> 5);
    const headerSize = ((data[position + 1] ?? 0) & 1) === 0 ? ADTS_HEADER_WITH_CRC_SIZE : ADTS_HEADER_SIZE;
    if (length < headerSize || position + length > data.length) {
      break;
    }
    pieces.push(data.subarray(position + headerSize, position + length));
    samples.push({ duration: AAC_FRAME_SAMPLES, size: length - headerSize, cto: 0, sync: true });
    position += length;
  }

  if (pieces.length === 0) {
    return fail(NOT_AUDIO);
  }
  return ok({ config: config.value, payload: concatBytes(pieces), samples });
}

/** An MPEG-4 descriptor with a one-byte length (all ours are shorter than 128 bytes). */
function descriptor(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = concatBytes(parts);
  return concatBytes([u8(tag, body.length), body]);
}

function audioSpecificConfig(config: AacConfig): Uint8Array {
  const bits = (config.objectType << 11) | (config.sampleRateIndex << 7) | (config.channels << 3);
  return u16(bits);
}

function sampleDescription(config: AacConfig): Uint8Array {
  const decoderConfig = descriptor(
    0x04,
    u8(0x40, 0x15),
    u8(0, 0, 0),
    u32(0, 0),
    descriptor(0x05, audioSpecificConfig(config)),
  );
  const esDescriptor = descriptor(0x03, u16(0), u8(0), decoderConfig, descriptor(0x06, u8(0x02)));
  const entry = box(
    'mp4a',
    u8(0, 0, 0, 0, 0, 0),
    u16(1),
    u32(0, 0),
    u16(CHANNEL_COUNTS[config.channels] ?? config.channels, 16, 0, 0),
    u32(Math.min(config.sampleRate, MAX_SAMPLE_RATE_FIELD) << 16),
    fullBox('esds', 0, 0, esDescriptor),
  );
  return fullBox('stsd', 0, 0, u32(1), entry);
}

/** The track an ADTS stream becomes in an `.m4a`: AAC with one sample per frame. */
export function aacTrack(config: AacConfig): TrackInfo {
  return {
    sourceId: 1,
    kind: 'audio',
    timescale: config.sampleRate,
    sampleDescription: sampleDescription(config),
    codec: 'mp4a',
    width: 0,
    height: 0,
    defaults: { duration: AAC_FRAME_SAMPLES, size: 0, flags: 0 },
  };
}

/** Same configuration, to tell a stream that changes its sound format half-way. */
export function sameConfig(left: AacConfig, right: AacConfig): boolean {
  return left.objectType === right.objectType && left.sampleRateIndex === right.sampleRateIndex && left.channels === right.channels;
}
