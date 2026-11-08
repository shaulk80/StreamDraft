import { afterEach, describe, expect, test, vi } from 'vitest';
import { concatBytes } from '../../src/engine/mp4/bytes.ts';
import { parseFragments } from '../../src/engine/mp4/fragment-reader.ts';
import { DAMAGED_MESSAGE, parseInitSegment } from '../../src/engine/mp4/init-reader.ts';
import type { SampleDefaults, TrackInfo } from '../../src/engine/mp4/types.ts';
import { initSegment, mediaSegment, sampleBytes, type FixtureTrack } from './mp4-fixtures.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const VIDEO: FixtureTrack = { id: 1, kind: 'video', timescale: 90_000, defaults: { duration: 3000, size: 0, flags: 0 } };
const AUDIO: FixtureTrack = { id: 2, kind: 'audio', timescale: 48_000 };

function defaultsFor(...ids: number[]): Map<number, SampleDefaults> {
  return new Map(ids.map((id) => [id, { duration: 0, size: 0, flags: 0 }]));
}

function tracksOf(data: Uint8Array): TrackInfo[] {
  const parsed = parseInitSegment(data);
  expect(parsed.ok).toBe(true);
  return parsed.ok ? parsed.value : [];
}

describe('parseInitSegment', () => {
  test('describes the audio and video tracks', () => {
    const tracks = tracksOf(initSegment([VIDEO, AUDIO]));

    expect(tracks.map((track) => [track.sourceId, track.kind, track.timescale, track.codec])).toEqual([
      [1, 'video', 90_000, 'avc1'],
      [2, 'audio', 48_000, 'mp4a'],
    ]);
    expect(tracks[0]?.width).toBe(320 << 16);
    expect(tracks[0]?.height).toBe(180 << 16);
    expect(tracks[0]?.defaults).toEqual({ duration: 3000, size: 0, flags: 0 });
    expect(tracks[0]?.matrix?.length).toBe(36);
  });

  test('keeps the sample description box whole', () => {
    const [track] = tracksOf(initSegment([VIDEO]));

    expect(new TextDecoder('latin1').decode(track?.sampleDescription.subarray(4, 8))).toBe('stsd');
  });

  test('leaves out tracks that are neither audio nor video', () => {
    const tracks = tracksOf(initSegment([VIDEO, { id: 3, kind: 'text', timescale: 1000 }]));

    expect(tracks.map((track) => track.sourceId)).toEqual([1]);
  });

  test.each(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09'])('accepts the video format %s', (codec) => {
    expect(parseInitSegment(initSegment([{ ...VIDEO, codec }])).ok).toBe(true);
  });

  test.each(['mp4a', 'ac-3', 'ec-3', 'Opus'])('accepts the audio format %s', (codec) => {
    expect(parseInitSegment(initSegment([{ ...AUDIO, codec }])).ok).toBe(true);
  });

  test.each([
    ['encv', 'This video is protected (encrypted) and cannot be downloaded.'],
    ['enca', 'This video is protected (encrypted) and cannot be downloaded.'],
    ['mjp2', 'This video uses a format (mjp2) that StreamDraft cannot save yet.'],
  ])('reports the format %s', (codec, message) => {
    expect(parseInitSegment(initSegment([{ ...VIDEO, codec }]))).toEqual({ ok: false, error: message });
  });

  test('reports a file with no tracks to save', () => {
    expect(parseInitSegment(initSegment([{ id: 3, kind: 'text', timescale: 1000 }]))).toEqual({
      ok: false,
      error: 'The video has no picture or sound to save.',
    });
  });

  test.each([
    ['empty data', new Uint8Array(0)],
    ['no movie box', new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112])],
    ['a cut-off movie box', initSegment([VIDEO]).subarray(0, 60)],
  ])('reports %s as damaged', (_name, data) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(parseInitSegment(data)).toEqual({ ok: false, error: DAMAGED_MESSAGE });
  });
});

describe('parseFragments', () => {
  const sampleSet = [
    { duration: 3000, size: 5, sync: true },
    { duration: 3000, size: 7, sync: false, cto: 6000 },
    { duration: 3000, size: 6, sync: false, cto: 3000 },
  ];

  test('reads samples, flags and the bytes of each', () => {
    const segment = mediaSegment([{ trackId: 1, startTime: 9000, firstIndex: 10, samples: sampleSet }]);

    const parsed = parseFragments(segment, defaultsFor(1));

    expect(parsed.ok).toBe(true);
    const [fragment] = parsed.ok ? parsed.value : [];
    expect(fragment?.sourceTrackId).toBe(1);
    expect(fragment?.startTime).toBe(9000);
    expect(fragment?.samples).toEqual([
      { duration: 3000, size: 5, cto: 0, sync: true },
      { duration: 3000, size: 7, cto: 6000, sync: false },
      { duration: 3000, size: 6, cto: 3000, sync: false },
    ]);
    expect(fragment?.payload).toEqual(concatBytes(sampleSet.map((sample, index) => sampleBytes(1, 10 + index, sample.size))));
  });

  test('reads signed composition offsets', () => {
    const segment = mediaSegment([{ trackId: 1, startTime: 0, firstIndex: 0, samples: [{ duration: 3000, size: 4, cto: -3000 }] }], { signedOffsets: true });

    const parsed = parseFragments(segment, defaultsFor(1));

    expect(parsed.ok && parsed.value[0]?.samples[0]?.cto).toBe(-3000);
  });

  test('takes durations, sizes and flags from the fragment header when the run leaves them out', () => {
    const samples = [
      { duration: 1024, size: 9, sync: true },
      { duration: 1024, size: 9, sync: true },
    ];
    const segment = mediaSegment([{ trackId: 2, startTime: 0, firstIndex: 0, samples }], { useDefaults: true });

    const parsed = parseFragments(segment, defaultsFor(2));

    expect(parsed.ok && parsed.value[0]?.samples).toEqual([
      { duration: 1024, size: 9, cto: 0, sync: true },
      { duration: 1024, size: 9, cto: 0, sync: true },
    ]);
  });

  test('reads several tracks from one movie fragment box and skips tracks it was not asked for', () => {
    const segment = mediaSegment(
      [
        { trackId: 1, startTime: 0, firstIndex: 0, samples: sampleSet },
        { trackId: 2, startTime: 0, firstIndex: 0, samples: [{ duration: 1024, size: 3 }] },
        { trackId: 3, startTime: 0, firstIndex: 0, samples: [{ duration: 1000, size: 2 }] },
      ],
      { combined: true },
    );

    const parsed = parseFragments(segment, defaultsFor(1, 2));

    expect(parsed.ok && parsed.value.map((fragment) => [fragment.sourceTrackId, fragment.payload.length])).toEqual([
      [1, 18],
      [2, 3],
    ]);
    expect(parsed.ok && parsed.value[1]?.payload).toEqual(sampleBytes(2, 0, 3));
  });

  test('a segment without movie fragments has no samples', () => {
    expect(parseFragments(initSegment([VIDEO]), defaultsFor(1))).toEqual({ ok: true, value: [] });
  });

  test('reports a layout with an absolute data offset as unsupported', () => {
    const segment = mediaSegment([{ trackId: 1, startTime: 0, firstIndex: 0, samples: sampleSet }], { absoluteBase: true });

    expect(parseFragments(segment, defaultsFor(1))).toEqual({
      ok: false,
      error: 'This video uses a layout of its parts that StreamDraft cannot join yet.',
    });
  });

  test('reports a segment cut off in the middle of its movie fragment box as damaged, not as empty', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const segment = mediaSegment([{ trackId: 1, startTime: 0, firstIndex: 0, samples: sampleSet }]);

    expect(parseFragments(segment.subarray(0, 60), defaultsFor(1))).toEqual({ ok: false, error: DAMAGED_MESSAGE });
  });

  test('reports a segment cut off in the middle of its data as damaged', () => {
    const segment = mediaSegment([{ trackId: 1, startTime: 0, firstIndex: 0, samples: sampleSet }]);

    expect(parseFragments(segment.subarray(0, segment.length - 4), defaultsFor(1))).toEqual({ ok: false, error: DAMAGED_MESSAGE });
  });
});
