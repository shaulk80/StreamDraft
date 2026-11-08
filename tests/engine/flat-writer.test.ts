import { describe, expect, test } from 'vitest';
import { fail, ok, type Result } from '../../src/core/result.ts';
import type { OutputSink } from '../../src/engine/output-sink.ts';
import { FlatMp4Writer } from '../../src/engine/mp4/flat-writer.ts';
import type { Sample, TrackInfo } from '../../src/engine/mp4/types.ts';
import { bytesOf, readFlatMp4 } from './flat-mp4-reader.ts';
import { sampleBytes } from './mp4-fixtures.ts';
import { MemoryOutputSink } from './memory-sink.ts';

function track(kind: 'video' | 'audio', timescale: number, sourceId = 1): TrackInfo {
  return {
    sourceId,
    kind,
    timescale,
    sampleDescription: new Uint8Array([0, 0, 0, 16, 115, 116, 115, 100, 0, 0, 0, 0, 0, 0, 0, 0]),
    codec: kind === 'video' ? 'avc1' : 'mp4a',
    width: 320 << 16,
    height: 180 << 16,
    defaults: { duration: 0, size: 0, flags: 0 },
  };
}

function samples(count: number, size: number, duration: number, extra: Partial<Sample> = {}): Sample[] {
  return Array.from({ length: count }, () => ({ duration, size, cto: 0, sync: true, ...extra }));
}

function payloadFor(trackId: number, firstIndex: number, list: Sample[]): Uint8Array {
  const parts = list.map((sample, index) => sampleBytes(trackId, firstIndex + index, sample.size));
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}

async function must<T>(result: Promise<Result<T>> | Result<T>): Promise<T> {
  const resolved = await result;
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  return resolved.value;
}

describe('FlatMp4Writer', () => {
  test('writes ftyp, one mdat and the movie box last; samples are found where the tables say', async () => {
    const sink = new MemoryOutputSink();
    const writer = new FlatMp4Writer(sink);
    const video = await must(writer.addTrack(track('video', 90_000)));
    const audio = await must(writer.addTrack(track('audio', 48_000, 2)));
    const videoSamples = samples(3, 5, 3000);
    const audioSamples = samples(2, 4, 1024);

    await must(writer.appendSamples(video, payloadFor(video, 0, videoSamples), videoSamples, 0));
    await must(writer.appendSamples(audio, payloadFor(audio, 0, audioSamples), audioSamples, 0));
    await must(writer.appendSamples(video, payloadFor(video, 3, videoSamples), videoSamples, 9000));
    const summary = await must(writer.finish());
    const file = sink.bytes();
    const read = readFlatMp4(file);

    expect(read.topLevel).toEqual(['ftyp', 'mdat', 'moov']);
    expect(read.brand).toBe('isom');
    expect(read.mdat.end - read.mdat.start).toBe(16 + 15 + 8 + 15);
    expect(summary).toMatchObject({ fileSize: file.length, audioOnly: false });
    const [videoTrack, audioTrack] = read.tracks;
    expect(videoTrack?.samples).toHaveLength(6);
    expect(audioTrack?.samples).toHaveLength(2);
    videoTrack?.samples.forEach((sample, index) => {
      expect(bytesOf(file, sample)).toEqual(sampleBytes(video, index, 5));
    });
    audioTrack?.samples.forEach((sample, index) => {
      expect(bytesOf(file, sample)).toEqual(sampleBytes(audio, index, 4));
    });
  });

  test('reports the length, the sample counts and the file size', async () => {
    const sink = new MemoryOutputSink();
    const writer = new FlatMp4Writer(sink);
    const id = await must(writer.addTrack(track('video', 90_000)));
    const list = samples(30, 2, 3000);
    await must(writer.appendSamples(id, payloadFor(id, 0, list), list, 0));

    const summary = await must(writer.finish());
    const read = readFlatMp4(sink.bytes());

    expect(summary.durationSeconds).toBe(1);
    expect(summary.tracks).toEqual([{ kind: 'video', samples: 30 }]);
    expect(read.movieDuration).toBe(1000);
    expect(read.tracks[0]?.mediaDuration).toBe(90_000);
    expect(read.tracks[0]?.edits).toEqual([{ duration: 1000, mediaTime: 0 }]);
  });

  test('omits the sync table when every sample is a sync sample, and builds it when not', async () => {
    const sink = new MemoryOutputSink();
    const writer = new FlatMp4Writer(sink);
    const video = await must(writer.addTrack(track('video', 90_000)));
    const audio = await must(writer.addTrack(track('audio', 48_000, 2)));
    const mixed = [{ duration: 3000, size: 1, cto: 0, sync: true }, ...samples(3, 1, 3000, { sync: false }), { duration: 3000, size: 1, cto: 0, sync: true }];
    await must(writer.appendSamples(video, payloadFor(video, 0, mixed), mixed, 0));
    await must(writer.appendSamples(audio, payloadFor(audio, 0, samples(2, 1, 1024)), samples(2, 1, 1024), 0));
    await must(writer.finish());

    const read = readFlatMp4(sink.bytes());

    expect(read.tracks.map((entry) => entry.hasSyncTable)).toEqual([true, false]);
    expect(read.tracks[0]?.samples.map((sample) => sample.sync)).toEqual([true, false, false, false, true]);
  });

  test('stores durations and composition offsets per sample, with negative offsets as signed', async () => {
    const sink = new MemoryOutputSink();
    const writer = new FlatMp4Writer(sink);
    const id = await must(writer.addTrack(track('video', 90_000)));
    const list: Sample[] = [
      { duration: 3000, size: 1, cto: 0, sync: true },
      { duration: 3000, size: 1, cto: 9000, sync: false },
      { duration: 1500, size: 1, cto: -3000, sync: false },
      { duration: 1500, size: 1, cto: 3000, sync: false },
    ];
    await must(writer.appendSamples(id, payloadFor(id, 0, list), list, 0));
    await must(writer.finish());

    const [video] = readFlatMp4(sink.bytes()).tracks;

    expect(video?.samples.map((sample) => [sample.dts, sample.pts])).toEqual([
      [0, 0],
      [3000, 12_000],
      [6000, 3000],
      [7500, 10_500],
    ]);
  });

  test('starts the picture at time zero when the first composition offset is not zero', async () => {
    const sink = new MemoryOutputSink();
    const writer = new FlatMp4Writer(sink);
    const id = await must(writer.addTrack(track('video', 90_000)));
    const list = samples(30, 1, 3000, { cto: 6000 });
    await must(writer.appendSamples(id, payloadFor(id, 0, list), list, 0));
    await must(writer.finish());

    const [video] = readFlatMp4(sink.bytes()).tracks;

    expect(video?.edits).toEqual([{ duration: 933, mediaTime: 6000 }]);
  });

  test('delays a track that starts later than the other and rebases to the earliest start', async () => {
    const sink = new MemoryOutputSink();
    const writer = new FlatMp4Writer(sink);
    const video = await must(writer.addTrack(track('video', 90_000)));
    const audio = await must(writer.addTrack(track('audio', 48_000, 2)));
    const videoSamples = samples(30, 1, 3000);
    const audioSamples = samples(47, 1, 1024);
    // Both start one hour in; the audio 0.5 s after the video.
    await must(writer.appendSamples(video, payloadFor(video, 0, videoSamples), videoSamples, 3600 * 90_000));
    await must(writer.appendSamples(audio, payloadFor(audio, 0, audioSamples), audioSamples, 3600 * 48_000 + 24_000));
    await must(writer.finish());

    const [videoTrack, audioTrack] = readFlatMp4(sink.bytes()).tracks;

    expect(videoTrack?.edits).toEqual([{ duration: 1000, mediaTime: 0 }]);
    expect(audioTrack?.edits).toEqual([
      { duration: 500, mediaTime: -1 },
      { duration: 1003, mediaTime: 0 },
    ]);
  });

  test('describes chunks of different sizes with the fewest sample-to-chunk entries', async () => {
    const sink = new MemoryOutputSink();
    const writer = new FlatMp4Writer(sink);
    const id = await must(writer.addTrack(track('audio', 48_000)));
    for (const count of [4, 4, 4, 2]) {
      const list = samples(count, 3, 1024);
      await must(writer.appendSamples(id, payloadFor(id, 0, list), list, 0));
    }
    await must(writer.finish());

    const [audio] = readFlatMp4(sink.bytes()).tracks;

    expect(audio?.samples).toHaveLength(14);
    expect(audio?.samples.at(-1)?.offset).toBe(readFlatMp4(sink.bytes()).mdat.body + 3 * 13);
  });

  test('uses an audio brand and a track without a picture header for sound only', async () => {
    const sink = new MemoryOutputSink();
    const writer = new FlatMp4Writer(sink);
    const id = await must(writer.addTrack(track('audio', 44_100)));
    const list = samples(10, 3, 1024);
    await must(writer.appendSamples(id, payloadFor(id, 0, list), list, 0));

    const summary = await must(writer.finish());
    const read = readFlatMp4(sink.bytes());

    expect(summary.audioOnly).toBe(true);
    expect(read.brand).toBe('M4A ');
    expect(read.tracks[0]?.handler).toBe('soun');
  });

  test('switches to 64-bit chunk offsets past 4 GiB', async () => {
    let position = 4_294_967_000;
    const written: Uint8Array[] = [];
    const sink: OutputSink = {
      get position() {
        return position;
      },
      append: (data) => {
        position += data.length;
        written.push(data);
        return Promise.resolve(ok(undefined));
      },
      patch: () => Promise.resolve(ok(undefined)),
      close: () => Promise.resolve(ok(undefined)),
      abort: () => Promise.resolve(),
    };
    const writer = new FlatMp4Writer(sink);
    const id = await must(writer.addTrack(track('video', 90_000)));
    const first = samples(40, 10, 3000);
    const second = samples(40, 10, 3000);
    await must(writer.appendSamples(id, payloadFor(id, 0, first), first, 0));
    await must(writer.appendSamples(id, payloadFor(id, 40, second), second, 120_000));
    await must(writer.finish());

    // The movie box is the last thing appended; wrap it so the reader finds it as the only top-level box.
    const moov = written.at(-1) ?? new Uint8Array(0);
    const fileLike = new Uint8Array([...new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112]), ...new Uint8Array([0, 0, 0, 8, 109, 100, 97, 116]), ...moov]);
    const [video] = readFlatMp4(fileLike).tracks;

    expect(video?.offsetBox).toBe('co64');
    expect(video?.samples.at(-1)?.offset).toBeGreaterThan(4_294_967_295);
  });

  test.each([
    ['no track at all', 0],
    ['tracks without samples', 1],
  ])('refuses to finish with %s', async (_name, trackCount) => {
    const writer = new FlatMp4Writer(new MemoryOutputSink());
    for (let index = 0; index < trackCount; index++) {
      await must(writer.addTrack(track('video', 90_000, index + 1)));
    }

    expect(await writer.finish()).toEqual({ ok: false, error: 'The video has no picture or sound to save.' });
  });

  test('refuses a track added after writing started and samples for an unknown track', async () => {
    const writer = new FlatMp4Writer(new MemoryOutputSink());
    const id = await must(writer.addTrack(track('video', 90_000)));
    const list = samples(1, 1, 3000);
    await must(writer.appendSamples(id, payloadFor(id, 0, list), list, 0));

    expect(writer.addTrack(track('audio', 48_000, 2))).toEqual({ ok: false, error: 'A track cannot be added once writing has started.' });
    expect(await writer.appendSamples(99, new Uint8Array(1), list, 0)).toEqual({ ok: false, error: 'The video has a track that was not announced.' });
  });

  test('passes on a failing sink', async () => {
    const sink = new MemoryOutputSink();
    sink.failAfterAppends = 2;
    const writer = new FlatMp4Writer(sink);
    const id = await must(writer.addTrack(track('video', 90_000)));
    const list = samples(1, 1, 3000);

    const result = await writer.appendSamples(id, payloadFor(id, 0, list), list, 0);

    expect(result).toEqual(fail('The finished video could not be written. The disk may be full.'));
  });
});
