import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ok } from '../../src/core/result.ts';
import { CANCELLED_MESSAGE } from '../../src/engine/cancelled.ts';
import type { MuxSource, StoredPart } from '../../src/engine/fragment-sources.ts';
import { concatBytes } from '../../src/engine/mp4/bytes.ts';
import { muxStreams } from '../../src/engine/mux-job.ts';
import { SegmentDecryptor, sequenceIv } from '../../src/engine/segment-decryptor.ts';
import { bytesOf, readFlatMp4, type ReadFile } from './flat-mp4-reader.ts';
import { MemoryOutputSink } from './memory-sink.ts';
import { MemorySegmentStore } from './memory-store.ts';
import { initSegment, mediaSegment, sampleBytes, type FixtureFragment, type FixtureSample, type FixtureTrack } from './mp4-fixtures.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const VIDEO: FixtureTrack = { id: 1, kind: 'video', timescale: 1000 };
const AUDIO: FixtureTrack = { id: 1, kind: 'audio', timescale: 1000 };

function run(count: number, size: number, duration: number): FixtureSample[] {
  return Array.from({ length: count }, (_unused, index) => ({ duration, size, sync: index === 0 }));
}

/** Stores an init segment and `segments` made of the given sample runs, and describes them as a source. */
function fmp4Source(store: MemorySegmentStore, prefix: string, track: FixtureTrack, segments: FixtureSample[][]): MuxSource {
  store.segments.set(`${prefix}-init`, initSegment([track]));
  let index = 0;
  let time = 0;
  const parts: StoredPart[] = segments.map((samples, number) => {
    const fragment: FixtureFragment = { trackId: track.id, startTime: time, firstIndex: index, samples };
    index += samples.length;
    time += samples.reduce((sum, sample) => sum + sample.duration, 0);
    store.segments.set(`${prefix}-${number}`, mediaSegment([fragment]));
    return { name: `${prefix}-${number}` };
  });
  return { format: 'fmp4', init: { name: `${prefix}-init` }, segments: parts };
}

async function mux(sources: MuxSource[], store: MemorySegmentStore, options = {}) {
  const sink = new MemoryOutputSink();
  const result = await muxStreams(sources, store, sink, options);
  return { result, sink, file: result.ok ? readFlatMp4(sink.bytes()) : undefined };
}

/** The tracks in the order their samples sit in the file, as [track id, number of samples] runs. */
function layoutOf(read: ReadFile): number[][] {
  const placed = read.tracks.flatMap((track) => track.samples.map((sample) => ({ id: track.id, offset: sample.offset })));
  placed.sort((left, right) => left.offset - right.offset);
  const runs: number[][] = [];
  for (const { id } of placed) {
    const last = runs.at(-1);
    if (last?.[0] === id) {
      last[1] = (last[1] ?? 0) + 1;
    } else {
      runs.push([id, 1]);
    }
  }
  return runs;
}

describe('muxStreams with fragmented MP4 sources', () => {
  test('joins a video and an audio stream into one file, every sample intact', async () => {
    const store = new MemorySegmentStore();
    const video = fmp4Source(store, 'v', VIDEO, [run(4, 10, 500), run(4, 12, 500)]);
    const audio = fmp4Source(store, 'a', AUDIO, [run(2, 5, 1000), run(2, 6, 1000)]);

    const { result, sink, file } = await mux([video, audio], store);

    expect(result).toMatchObject({ ok: true, value: { extension: 'mp4', audioOnly: false, durationSeconds: 4 } });
    const bytes = sink.bytes();
    const [videoTrack, audioTrack] = file?.tracks ?? [];
    expect(videoTrack).toMatchObject({ id: 1, handler: 'vide' });
    expect(audioTrack).toMatchObject({ id: 2, handler: 'soun' });
    expect(videoTrack?.samples).toHaveLength(8);
    expect(audioTrack?.samples).toHaveLength(4);
    videoTrack?.samples.forEach((sample, index) => {
      expect(bytesOf(bytes, sample)).toEqual(sampleBytes(1, index, index < 4 ? 10 : 12));
    });
    audioTrack?.samples.forEach((sample, index) => {
      expect(bytesOf(bytes, sample)).toEqual(sampleBytes(1, index, index < 2 ? 5 : 6));
    });
  });

  test('writes the stream that is furthest behind next, so both advance together', async () => {
    const store = new MemorySegmentStore();
    const video = fmp4Source(store, 'v', VIDEO, [run(4, 3, 500), run(4, 3, 500)]);
    const audio = fmp4Source(store, 'a', AUDIO, [run(2, 3, 500), run(2, 3, 500), run(2, 3, 500), run(2, 3, 500)]);

    const { file } = await mux([video, audio], store);

    // Video is 2 s per segment and audio 1 s: two audio segments for each video segment.
    expect(layoutOf(file as ReadFile)).toEqual([
      [1, 4],
      [2, 4],
      [1, 4],
      [2, 4],
    ]);
  });

  test('renumbers the tracks of different sources that share an id', async () => {
    const store = new MemorySegmentStore();
    const video = fmp4Source(store, 'v', VIDEO, [run(2, 3, 500)]);
    const audio = fmp4Source(store, 'a', AUDIO, [run(2, 3, 500)]);

    const { file } = await mux([video, audio], store);

    expect(file?.tracks.map((track) => track.id)).toEqual([1, 2]);
  });

  test('a stream with only sound gives an .m4a', async () => {
    const store = new MemorySegmentStore();

    const { result, file } = await mux([fmp4Source(store, 'a', AUDIO, [run(3, 4, 1000)])], store);

    expect(result.ok && result.value.extension).toBe('m4a');
    expect(file?.brand).toBe('M4A ');
  });

  test('reports progress per segment up to the total', async () => {
    const store = new MemorySegmentStore();
    const sources = [fmp4Source(store, 'v', VIDEO, [run(1, 1, 500), run(1, 1, 500)]), fmp4Source(store, 'a', AUDIO, [run(1, 1, 500)])];
    const onProgress = vi.fn();

    await mux(sources, store, { onProgress });

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { doneSegments: 1, totalSegments: 3 },
      { doneSegments: 2, totalSegments: 3 },
      { doneSegments: 3, totalSegments: 3 },
    ]);
  });

  test('an unknown format of a track is reported in words', async () => {
    const store = new MemorySegmentStore();
    const source = fmp4Source(store, 'v', { ...VIDEO, codec: 'mjp2' }, [run(1, 1, 500)]);

    const { result } = await mux([source], store);

    expect(result).toEqual({ ok: false, error: 'This video uses a format (mjp2) that StreamDraft cannot save yet.' });
  });

  test.each([
    ['no sources', []],
    ['a source with no segments', [{ format: 'fmp4' as const, init: { name: 'i' }, segments: [] }]],
  ])('refuses %s', async (_name, sources) => {
    const { result } = await mux(sources, new MemorySegmentStore());

    expect(result).toEqual({ ok: false, error: 'The video has no parts to join.' });
  });

  test('refuses a fragmented MP4 source without its init section', async () => {
    const store = new MemorySegmentStore();
    const source = fmp4Source(store, 'v', VIDEO, [run(1, 1, 500)]);

    const { result } = await mux([{ ...source, init: undefined }], store);

    expect(result).toEqual({ ok: false, error: 'The video has no initialisation data.' });
  });

  test('reports a part that is missing from the store', async () => {
    const store = new MemorySegmentStore();
    const source = fmp4Source(store, 'v', VIDEO, [run(1, 1, 500), run(1, 1, 500)]);
    store.segments.delete('v-1');

    const { result } = await mux([source], store);

    expect(result.ok).toBe(false);
  });

  test('reports a damaged segment', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new MemorySegmentStore();
    const source = fmp4Source(store, 'v', VIDEO, [run(2, 20, 500)]);
    store.segments.set('v-0', (store.segments.get('v-0') ?? new Uint8Array(0)).subarray(0, 100));

    const { result } = await mux([source], store);

    expect(result).toEqual({ ok: false, error: 'A part of the video is damaged and cannot be joined.' });
  });

  test('a sink that cannot write ends the job with its message', async () => {
    const store = new MemorySegmentStore();
    const source = fmp4Source(store, 'v', VIDEO, [run(2, 5, 500)]);
    const sink = new MemoryOutputSink();
    sink.failAfterAppends = 1;

    const result = await muxStreams([source], store, sink);

    expect(result).toEqual({ ok: false, error: 'The finished video could not be written. The disk may be full.' });
  });

  describe('cancel', () => {
    test('stops before the next segment', async () => {
      const store = new MemorySegmentStore();
      const source = fmp4Source(store, 'v', VIDEO, [run(1, 1, 500), run(1, 1, 500), run(1, 1, 500)]);
      const controller = new AbortController();
      const onProgress = vi.fn(() => controller.abort());

      const { result } = await mux([source], store, { signal: controller.signal, onProgress });

      expect(result).toEqual({ ok: false, error: CANCELLED_MESSAGE });
      expect(onProgress).toHaveBeenCalledTimes(1);
    });
  });

  describe('encrypted parts', () => {
    const KEY = new Uint8Array(16).map((_unused, index) => 50 + index);
    const KEY_URL = 'https://cdn.example.com/key';

    async function encryptedSource(store: MemorySegmentStore): Promise<MuxSource> {
      const source = fmp4Source(store, 'v', VIDEO, [run(2, 20, 500), run(2, 20, 500)]);
      const key = await crypto.subtle.importKey('raw', KEY, 'AES-CBC', false, ['encrypt']);
      const parts: StoredPart[] = [];
      for (const [number, part] of source.segments.entries()) {
        const plain = store.segments.get(part.name) ?? new Uint8Array(0);
        const padded = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: sequenceIv(number) }, key, new Uint8Array(plain)));
        store.segments.set(part.name, padded);
        parts.push({ name: part.name, key: { url: KEY_URL }, sequence: number });
      }
      return { ...source, segments: parts };
    }

    test('decrypts each segment before joining', async () => {
      const store = new MemorySegmentStore();
      const source = await encryptedSource(store);
      const decryptor = new SegmentDecryptor(() => Promise.resolve(ok(KEY)));

      const { result, sink, file } = await mux([source], store, { decryptor });

      expect(result.ok).toBe(true);
      const sample = file?.tracks[0]?.samples[3];
      expect(sample && bytesOf(sink.bytes(), sample)).toEqual(sampleBytes(1, 3, 20));
    });

    test('says so when there is no way to get the key', async () => {
      const store = new MemorySegmentStore();
      const source = await encryptedSource(store);

      const { result } = await mux([source], store);

      expect(result).toEqual({ ok: false, error: 'The video is encrypted and no key was available.' });
    });
  });
});

describe('muxStreams with MPEG-TS sources', () => {
  function fixture(name: string): Uint8Array {
    return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  }

  test('joins two segments of a stream whose second segment starts mid-picture-group: each sample is one picture', async () => {
    const store = new MemorySegmentStore();
    store.segments.set('t0', fixture('bipbop-gop-a.mpegts'));
    store.segments.set('t1', fixture('bipbop-gop-b.mpegts'));
    const source: MuxSource = { format: 'ts', segments: [{ name: 't0' }, { name: 't1' }] };

    const { result, file } = await mux([source], store);

    expect(result.ok).toBe(true);
    const video = file?.tracks.find((track) => track.handler === 'vide');
    const audio = file?.tracks.find((track) => track.handler === 'soun');
    expect(video?.samples.length).toBeGreaterThan(30);
    expect(new Set(video?.samples.map((sample) => sample.pts)).size).toBe(video?.samples.length);
    expect(new Set(video?.samples.map((sample) => sample.dts)).size).toBe(video?.samples.length);
    expect(audio?.samples.length).toBeGreaterThan(0);
    expect(video?.samples[0]?.sync).toBe(true);
  });

  test('reports a segment that is not a transport stream', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new MemorySegmentStore();
    store.segments.set('t0', new Uint8Array(1000).fill(9));

    const { result } = await mux([{ format: 'ts', segments: [{ name: 't0' }] }], store);

    expect(result).toEqual({ ok: false, error: 'A part of the video is not in the format the page said it was.' });
  });
});

describe('muxStreams with ADTS audio', () => {
  function adtsFrame(body: number): Uint8Array {
    const length = 7 + body;
    const header = Uint8Array.of(0xff, 0xf1, (1 << 6) | (4 << 2), (2 << 6) | (length >> 11), (length >> 3) & 0xff, ((length & 7) << 5) | 0x1f, 0xfc);
    return concatBytes([header, new Uint8Array(body).fill(body)]);
  }

  test('wraps the frames of each segment in an .m4a with the real length', async () => {
    const store = new MemorySegmentStore();
    store.segments.set('s0', concatBytes([adtsFrame(10), adtsFrame(11)]));
    store.segments.set('s1', concatBytes([adtsFrame(12), adtsFrame(13), adtsFrame(14)]));

    const { result, sink, file } = await mux([{ format: 'adts', segments: [{ name: 's0' }, { name: 's1' }] }], store);

    expect(result).toMatchObject({ ok: true, value: { extension: 'm4a', audioOnly: true } });
    const [audio] = file?.tracks ?? [];
    expect(audio?.timescale).toBe(44_100);
    expect(audio?.samples.map((sample) => sample.size)).toEqual([10, 11, 12, 13, 14]);
    expect(audio?.samples.map((sample) => sample.dts)).toEqual([0, 1024, 2048, 3072, 4096]);
    expect(audio?.samples.every((sample, index) => bytesOf(sink.bytes(), sample).every((byte) => byte === 10 + index))).toBe(true);
  });

  test('refuses a stream that changes its sound format half-way', async () => {
    const store = new MemorySegmentStore();
    const other = adtsFrame(10);
    other[2] = (1 << 6) | (3 << 2);
    store.segments.set('s0', adtsFrame(10));
    store.segments.set('s1', other);

    const { result } = await mux([{ format: 'adts', segments: [{ name: 's0' }, { name: 's1' }] }], store);

    expect(result).toEqual({ ok: false, error: 'The sound changes its format in the middle of the audio, which StreamDraft cannot join.' });
  });
});
