import { fail, ok, type Result } from '../../../src/core/result.ts';
import { concatBytes } from '../../../src/engine/mp4/bytes.ts';
import type { PartSink, RecordedPart } from '../../../src/extractors/capture/types.ts';
import { initSegment, mediaSegment, type FixtureTrack } from '../../engine/mp4-fixtures.ts';

export const VIDEO_TRACK: FixtureTrack = { id: 1, kind: 'video', timescale: 1000 };
export const AUDIO_TRACK: FixtureTrack = { id: 2, kind: 'audio', timescale: 1000 };

/** A one-second media segment of a track: two samples of half a second. */
export function secondSegment(track: FixtureTrack, second: number): Uint8Array {
  return mediaSegment([
    {
      trackId: track.id,
      startTime: second * 1000,
      firstIndex: second * 2,
      samples: [
        { duration: 500, size: 40 },
        { duration: 500, size: 40 },
      ],
    },
  ]);
}

/** The init section and `seconds` one-second segments of a track, as the player would append them one after the other. */
export function trackStream(track: FixtureTrack, seconds: number, firstSecond = 0): Uint8Array[] {
  const segments = Array.from({ length: seconds }, (_, index) => secondSegment(track, firstSecond + index));
  return [initSegment([track]), ...segments];
}

/** Cuts bytes into pieces of `size` bytes, the way a player appends a segment in several goes. */
export function chunked(parts: readonly Uint8Array[], size: number): Uint8Array[] {
  const all = concatBytes(parts);
  const pieces: Uint8Array[] = [];
  for (let at = 0; at < all.length; at += size) {
    pieces.push(all.slice(at, at + size));
  }
  return pieces;
}

/** A sink that keeps what it is given; `failOn` makes the store of that kind of part fail. */
export function memorySink(failOn?: RecordedPart['kind']) {
  const stored: { bufferId: number; part: RecordedPart }[] = [];
  const sink: PartSink = {
    store(bufferId, part): Promise<Result<void>> {
      if (part.kind === failOn) {
        return Promise.resolve(fail('The disk is full.'));
      }
      stored.push({ bufferId, part });
      return Promise.resolve(ok(undefined));
    },
  };
  return { sink, stored };
}
