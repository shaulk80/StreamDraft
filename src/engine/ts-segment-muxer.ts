import muxjs from 'mux.js';
import { fail, ok, type Result } from '../core/result.ts';
import { DAMAGED_MESSAGE, parseInitSegment } from './mp4/init-reader.ts';
import { parseFragments } from './mp4/fragment-reader.ts';
import type { TrackFragment, TrackInfo } from './mp4/types.ts';

/** mux.js counts its video in 90 kHz ticks. */
const MPEG_TS_CLOCK = 90_000;

const NOT_TS = 'A part of the video is not in the format the page said it was.';

export interface TsSegmentFragments {
  /** The tracks mux.js found in this segment. */
  tracks: TrackInfo[];
  fragments: TrackFragment[];
}

/**
 * Drops the leading samples that mux.js copied from the previous segment.
 * Without a keyframe at its start, a segment gets the previous group of
 * pictures put in front, for a player that overwrites the overlap; in a file
 * those pictures would show twice.
 */
export function dropPrepended(fragment: TrackFragment, prependedTicks: number, timescale: number): TrackFragment {
  const limit = (prependedTicks / MPEG_TS_CLOCK) * timescale;
  let dropped = 0;
  let droppedTicks = 0;
  let droppedBytes = 0;
  while (dropped < fragment.samples.length && droppedTicks < limit) {
    const sample = fragment.samples[dropped];
    droppedTicks += sample?.duration ?? 0;
    droppedBytes += sample?.size ?? 0;
    dropped++;
  }

  if (dropped === 0) {
    return fragment;
  }
  return {
    sourceTrackId: fragment.sourceTrackId,
    samples: fragment.samples.slice(dropped),
    payload: fragment.payload.subarray(droppedBytes),
    startTime: fragment.startTime === undefined ? undefined : fragment.startTime + droppedTicks,
  };
}

/**
 * Turns MPEG-TS segments into sample runs with mux.js, one segment at a time
 * (the instance keeps what mux.js needs to join one segment to the next, so
 * use one per stream, in order).
 */
export class TsSegmentMuxer {
  private readonly transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false });
  private pendingPrepended = 0;
  private output: { initSegment: Uint8Array; data: Uint8Array; prepended: number }[] = [];
  /** The tracks mux.js found, read from the init segment of the first segment. */
  private tracks: TrackInfo[] | undefined;

  constructor() {
    this.transmuxer.on('videoSegmentTimingInfo', (info) => {
      this.pendingPrepended = info.prependedContentDuration;
    });
    this.transmuxer.on('data', (segment) => {
      this.output.push({ initSegment: segment.initSegment, data: segment.data, prepended: this.pendingPrepended });
      this.pendingPrepended = 0;
    });
  }

  push(segment: Uint8Array): Result<TsSegmentFragments> {
    this.output = [];
    try {
      this.transmuxer.push(segment);
      this.transmuxer.flush();
    } catch (error) {
      console.error('StreamDraft: mux.js could not read a segment', error);
      return fail(NOT_TS);
    }

    const [first] = this.output;
    if (first === undefined) {
      return fail(NOT_TS);
    }

    if (this.tracks === undefined) {
      const tracks = parseInitSegment(first.initSegment);
      if (!tracks.ok) {
        return tracks;
      }
      this.tracks = tracks.value;
    }
    return this.fragmentsOf(this.tracks);
  }

  dispose(): void {
    this.transmuxer.dispose();
  }

  private fragmentsOf(tracks: TrackInfo[]): Result<TsSegmentFragments> {
    const defaults = new Map(tracks.map((track) => [track.sourceId, track.defaults]));
    const fragments: TrackFragment[] = [];
    for (const piece of this.output) {
      const parsed = parseFragments(piece.data, defaults);
      if (!parsed.ok) {
        return fail(DAMAGED_MESSAGE);
      }

      for (const fragment of parsed.value) {
        const track = tracks.find((candidate) => candidate.sourceId === fragment.sourceTrackId);
        const isVideo = track?.kind === 'video';
        fragments.push(isVideo && piece.prepended > 0 ? dropPrepended(fragment, piece.prepended, track.timescale) : fragment);
      }
    }
    return ok({ tracks, fragments });
  }
}
