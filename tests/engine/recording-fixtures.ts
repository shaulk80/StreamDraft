import type { RecordingBuffer, RecordingInput, RecordingPart } from '../../src/engine/recording-input.ts';
import { initSegment, mediaSegment, type FixtureTrack } from './mp4-fixtures.ts';

const VIDEO: FixtureTrack = { id: 1, kind: 'video', timescale: 1000 };
const AUDIO: FixtureTrack = { id: 1, kind: 'audio', timescale: 1000 };
const SEGMENTS = 2;
const SAMPLES_PER_SEGMENT = 2;

export interface RecordingFixture {
  recording: RecordingInput;
  /** The bytes behind every `blob:` address, for the parts that are reached by address. */
  served: Map<string, Uint8Array>;
}

export interface RecordingFixtureOptions {
  /** Reach the parts by `blob:` address (Chrome) instead of by `File` (Firefox). */
  viaUrl?: boolean;
  /** List the segments of each buffer latest first, the way a player that seeked back may have stored them. */
  reversed?: boolean;
  /** Leave out the audio buffer. */
  videoOnly?: boolean;
}

function segments(track: FixtureTrack): Uint8Array[] {
  return Array.from({ length: SEGMENTS }, (_unused, number) => {
    const samples = Array.from({ length: SAMPLES_PER_SEGMENT }, (_sample, index) => ({ duration: 500, size: 10, sync: index === 0 }));
    return mediaSegment([{ trackId: track.id, startTime: number * 1000, firstIndex: number * SAMPLES_PER_SEGMENT, samples }]);
  });
}

/** A recording of a video and an audio buffer, two one-second segments each. */
export function recordingFixture(options: RecordingFixtureOptions = {}): RecordingFixture {
  const served = new Map<string, Uint8Array>();

  function part(name: string, bytes: Uint8Array, startSeconds?: number): RecordingPart {
    if (options.viaUrl === true) {
      const url = `blob:page/${name}`;
      served.set(url, bytes);
      return { name, startSeconds, url };
    }
    return { name, startSeconds, file: { size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0) as ArrayBuffer) } };
  }

  function buffer(prefix: string, kind: 'video' | 'audio', track: FixtureTrack): RecordingBuffer {
    const fragments = segments(track).map((bytes, number) => part(`${prefix}-${number}`, bytes, number));
    return {
      kind,
      init: part(`${prefix}-init`, initSegment([track])),
      fragments: options.reversed === true ? fragments.reverse() : fragments,
    };
  }

  const buffers = [buffer('v', 'video', VIDEO)];
  if (options.videoOnly !== true) {
    buffers.push(buffer('a', 'audio', AUDIO));
  }
  return { recording: { buffers }, served };
}
