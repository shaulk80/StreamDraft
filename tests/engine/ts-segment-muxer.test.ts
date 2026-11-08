import { readFileSync } from 'node:fs';
import muxjs from 'mux.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { parseFragments } from '../../src/engine/mp4/fragment-reader.ts';
import { parseInitSegment } from '../../src/engine/mp4/init-reader.ts';
import type { TrackFragment } from '../../src/engine/mp4/types.ts';
import { dropPrepended, TsSegmentMuxer } from '../../src/engine/ts-segment-muxer.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

/** Two consecutive segments of Apple's bipbop stream, cut down. The second starts in the middle of a group of pictures. */
const SEGMENT_A = fixture('bipbop-gop-a.mpegts');
const SEGMENT_B = fixture('bipbop-gop-b.mpegts');

interface Timeline {
  count: number;
  distinctPresentationTimes: number;
}

/** Counts samples and their distinct presentation times over fragments in order. Each fragment starts at its own stated time, so overlapping fragments show up. */
function timelineOf(fragments: readonly TrackFragment[]): Timeline {
  let decodingTime = 0;
  const presentationTimes = new Set<number>();
  let count = 0;
  for (const fragment of fragments) {
    decodingTime = fragment.startTime ?? decodingTime;
    for (const sample of fragment.samples) {
      presentationTimes.add(decodingTime + sample.cto);
      decodingTime += sample.duration;
      count++;
    }
  }
  return { count, distinctPresentationTimes: presentationTimes.size };
}

/** Distance between where each video fragment ends and the next one starts: all zero when the timeline is gapless. */
function gapsBetween(fragments: readonly TrackFragment[]): number[] {
  return fragments.slice(1).map((fragment, index) => {
    const previous = fragments[index];
    const end = (previous?.startTime ?? 0) + (previous?.samples.reduce((sum, sample) => sum + sample.duration, 0) ?? 0);
    return (fragment.startTime ?? 0) - end;
  });
}

/** What mux.js gives for the two segments untouched: the video fragments, to compare with the trimmed ones. */
function untrimmedVideo(): TrackFragment[] {
  const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false });
  const fragments: TrackFragment[] = [];
  let defaults = new Map<number, { duration: number; size: number; flags: number }>();
  transmuxer.on('data', (segment) => {
    const tracks = parseInitSegment(segment.initSegment);
    if (tracks.ok) {
      defaults = new Map(tracks.value.map((track) => [track.sourceId, track.defaults]));
      const videoId = tracks.value.find((track) => track.kind === 'video')?.sourceId;
      const parsed = parseFragments(segment.data, defaults);
      if (parsed.ok) {
        fragments.push(...parsed.value.filter((fragment) => fragment.sourceTrackId === videoId));
      }
    }
  });
  for (const segment of [SEGMENT_A, SEGMENT_B]) {
    transmuxer.push(segment);
    transmuxer.flush();
  }
  return fragments;
}

describe('TsSegmentMuxer', () => {
  test('finds the video and the audio track and gives their samples', () => {
    const muxer = new TsSegmentMuxer();

    const first = muxer.push(SEGMENT_A);

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.tracks.map((track) => [track.kind, track.codec])).toEqual([
      ['video', 'avc1'],
      ['audio', 'mp4a'],
    ]);
    expect(first.value.fragments.length).toBeGreaterThan(0);
    muxer.dispose();
  });

  test('the fixture really makes mux.js repeat pictures: the untouched output shows some twice', () => {
    const timeline = timelineOf(untrimmedVideo());

    expect(timeline.distinctPresentationTimes).toBeLessThan(timeline.count);
  });

  test('drops the repeated pictures so every sample has its own presentation time', () => {
    const muxer = new TsSegmentMuxer();
    const video: TrackFragment[] = [];
    for (const segment of [SEGMENT_A, SEGMENT_B]) {
      const pushed = muxer.push(segment);
      expect(pushed.ok).toBe(true);
      if (pushed.ok) {
        const videoId = pushed.value.tracks.find((track) => track.kind === 'video')?.sourceId;
        video.push(...pushed.value.fragments.filter((fragment) => fragment.sourceTrackId === videoId));
      }
    }
    muxer.dispose();

    const trimmed = timelineOf(video);
    const untrimmed = timelineOf(untrimmedVideo());

    expect(trimmed.distinctPresentationTimes).toBe(trimmed.count);
    expect(gapsBetween(video)).toEqual([0]);
    expect(untrimmed.count - trimmed.count).toBeGreaterThan(0);
  });

  test.each([
    ['empty data', new Uint8Array(0)],
    ['something that is not a transport stream', new Uint8Array(2000).fill(3)],
  ])('reports %s', (_name, data) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const muxer = new TsSegmentMuxer();

    expect(muxer.push(data)).toEqual({ ok: false, error: 'A part of the video is not in the format the page said it was.' });
  });
});

describe('dropPrepended', () => {
  const fragment: TrackFragment = {
    sourceTrackId: 1,
    samples: [3, 4, 5, 6, 7].map((size) => ({ duration: 3000, size, cto: 0, sync: size === 3 })),
    payload: Uint8Array.from([1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5]),
    startTime: 90_000,
  };

  test.each([
    [0, 0],
    [3000, 1],
    [6000, 2],
    [6001, 3],
    [90_000, 5],
  ])('with %i ticks prepended drops %i samples, their bytes and moves the start', (prepended, dropped) => {
    const result = dropPrepended(fragment, prepended, 90_000);

    expect(result.samples).toHaveLength(5 - dropped);
    const droppedBytes = fragment.samples.slice(0, dropped).reduce((sum, sample) => sum + sample.size, 0);
    expect(result.payload).toEqual(fragment.payload.subarray(droppedBytes));
    expect(result.startTime).toBe(90_000 + dropped * 3000);
  });

  test('converts the 90 kHz count to the track clock', () => {
    const slow = { ...fragment, samples: fragment.samples.map((sample) => ({ ...sample, duration: 1500 })) };

    expect(dropPrepended(slow, 6000, 45_000).samples).toHaveLength(3);
  });
});
