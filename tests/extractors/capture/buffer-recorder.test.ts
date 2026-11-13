import { describe, expect, test, vi } from 'vitest';
import { ENCRYPTED_MESSAGE } from '../../../src/engine/mp4/init-reader.ts';
import { BufferRecorder, type RecorderEvents } from '../../../src/extractors/capture/buffer-recorder.ts';
import type { PartSink } from '../../../src/extractors/capture/types.ts';
import { initSegment } from '../../engine/mp4-fixtures.ts';
import { AUDIO_TRACK, chunked, memorySink, secondSegment, trackStream, VIDEO_TRACK } from './stream-fixtures.ts';

function createRecorder(sink: PartSink, mime = 'video/mp4; codecs="avc1.4d401e"') {
  const events = { problem: vi.fn<RecorderEvents['problem']>(), protectedMedia: vi.fn<RecorderEvents['protectedMedia']>() };
  return { recorder: new BufferRecorder(1, 1, mime, sink, events), events };
}

async function pushAll(recorder: BufferRecorder, chunks: readonly Uint8Array[]): Promise<void> {
  for (const chunk of chunks) {
    await recorder.push(chunk);
  }
}

describe('BufferRecorder', () => {
  test.each([1000, 250, 31])('stores the init section and each segment once and knows what it covers (pieces of %s bytes)', async (size) => {
    const { sink, stored } = memorySink();
    const { recorder, events } = createRecorder(sink);

    await pushAll(recorder, chunked(trackStream(VIDEO_TRACK, 4), size));

    expect(stored.map(({ part }) => [part.kind, part.index, part.startSeconds, part.endSeconds])).toEqual([
      ['init', 0, undefined, undefined],
      ['fragment', 1, 0, 1],
      ['fragment', 2, 1, 2],
      ['fragment', 3, 2, 3],
      ['fragment', 4, 3, 4],
    ]);
    expect(recorder.snapshot()).toMatchObject({ kind: 'video', initStored: true, fragmentCount: 4, duplicateCount: 0, covered: [{ start: 0, end: 4 }], coveredSeconds: 4 });
    expect(events.problem).not.toHaveBeenCalled();
  });

  test('a segment the player appends again is stored once', async () => {
    const { sink, stored } = memorySink();
    const { recorder, events } = createRecorder(sink);

    await pushAll(recorder, [...trackStream(VIDEO_TRACK, 2), secondSegment(VIDEO_TRACK, 1), secondSegment(VIDEO_TRACK, 0)]);

    expect(stored.filter(({ part }) => part.kind === 'fragment')).toHaveLength(2);
    expect(recorder.snapshot()).toMatchObject({ fragmentCount: 2, duplicateCount: 2 });
    expect(events.problem).not.toHaveBeenCalled();
  });

  test('segments that arrive out of order are placed by their time', async () => {
    const { sink } = memorySink();
    const { recorder } = createRecorder(sink);
    const [init, first, second, third] = trackStream(VIDEO_TRACK, 3);

    await pushAll(recorder, [init ?? new Uint8Array(), third ?? new Uint8Array(), first ?? new Uint8Array(), second ?? new Uint8Array()]);

    expect(recorder.snapshot().covered).toEqual([{ start: 0, end: 3 }]);
  });

  test('a hole in the video shows as two covered ranges', async () => {
    const { sink } = memorySink();
    const { recorder } = createRecorder(sink);
    const [init, ...segments] = trackStream(VIDEO_TRACK, 5);

    await pushAll(recorder, [init ?? new Uint8Array(), segments[0] ?? new Uint8Array(), segments[3] ?? new Uint8Array(), segments[4] ?? new Uint8Array()]);

    expect(recorder.snapshot().covered).toEqual([{ start: 0, end: 1 }, { start: 3, end: 5 }]);
  });

  test('an init section sent again is ignored', async () => {
    const { sink, stored } = memorySink();
    const { recorder, events } = createRecorder(sink);

    await pushAll(recorder, [...trackStream(VIDEO_TRACK, 1), initSegment([VIDEO_TRACK]), secondSegment(VIDEO_TRACK, 1)]);

    expect(stored.filter(({ part }) => part.kind === 'init')).toHaveLength(1);
    expect(recorder.snapshot().fragmentCount).toBe(2);
    expect(events.problem).not.toHaveBeenCalled();
  });

  test('a different init section means the player switched quality: it stops and says where', async () => {
    const { sink, stored } = memorySink();
    const { recorder, events } = createRecorder(sink);

    await pushAll(recorder, [...trackStream(VIDEO_TRACK, 65), initSegment([{ ...VIDEO_TRACK, timescale: 90_000 }]), secondSegment(VIDEO_TRACK, 65)]);

    expect(events.problem).toHaveBeenCalledTimes(1);
    expect(events.problem.mock.calls[0]?.[0]).toContain('changed the quality of the video at 1:05');
    expect(recorder.snapshot().stoppedBecause).toContain('changed the quality');
    expect(stored.filter(({ part }) => part.kind === 'fragment')).toHaveLength(65);
  });

  test('the sound track of an audio buffer is recorded the same way', async () => {
    const { sink } = memorySink();
    const { recorder } = createRecorder(sink, 'audio/mp4; codecs="mp4a.40.2"');

    await pushAll(recorder, trackStream(AUDIO_TRACK, 2));

    expect(recorder.snapshot()).toMatchObject({ kind: 'audio', coveredSeconds: 2 });
  });

  test('encrypted media is reported and not recorded', async () => {
    const { sink, stored } = memorySink();
    const { recorder, events } = createRecorder(sink);

    await pushAll(recorder, trackStream({ ...VIDEO_TRACK, codec: 'encv' }, 2));

    expect(events.protectedMedia).toHaveBeenCalledTimes(1);
    expect(events.problem).toHaveBeenCalledWith(ENCRYPTED_MESSAGE);
    expect(stored).toEqual([]);
  });

  test.each([
    ['a codec it cannot join', trackStream({ ...VIDEO_TRACK, codec: 'vp08' }, 1), 'cannot save'],
    ['media before the init section', [secondSegment(VIDEO_TRACK, 0)], 'before it described it'],
    ['bytes that are not a stream', [new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])], 'damaged'],
  ])('stops with a message for %s', async (_name, chunks, expected) => {
    const { sink, stored } = memorySink();
    const { recorder, events } = createRecorder(sink);

    await pushAll(recorder, chunks);

    expect(events.problem).toHaveBeenCalledTimes(1);
    expect(events.problem.mock.calls[0]?.[0]).toContain(expected);
    expect(stored).toEqual([]);
  });

  test.each(['init', 'fragment'] as const)('stops when storing the %s fails, and keeps what was stored before', async (failing) => {
    const { sink, stored } = memorySink(failing);
    const { recorder, events } = createRecorder(sink);

    await pushAll(recorder, trackStream(VIDEO_TRACK, 3));

    expect(events.problem).toHaveBeenCalledWith('The disk is full.');
    expect(stored.filter(({ part }) => part.kind === 'fragment')).toEqual([]);
    expect(recorder.snapshot().stoppedBecause).toBe('The disk is full.');
  });

  test('a sink that throws is a problem, not an exception', async () => {
    const throwing: PartSink = { store: () => Promise.reject(new Error('boom')) };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { recorder, events } = createRecorder(throwing);

    await pushAll(recorder, trackStream(VIDEO_TRACK, 1));

    expect(events.problem).toHaveBeenCalledWith('The recording could not be stored.');
  });

  test('stop() ends the recording from outside', async () => {
    const { sink, stored } = memorySink();
    const { recorder } = createRecorder(sink);
    await pushAll(recorder, trackStream(VIDEO_TRACK, 1));

    recorder.stop('The user cancelled.');
    await pushAll(recorder, [secondSegment(VIDEO_TRACK, 1)]);

    expect(stored).toHaveLength(2);
    expect(recorder.snapshot().stoppedBecause).toBe('The user cancelled.');
  });

  test('pushes made without waiting are handled in order', async () => {
    const { sink, stored } = memorySink();
    const { recorder } = createRecorder(sink);

    await Promise.all(trackStream(VIDEO_TRACK, 5).map((chunk) => recorder.push(chunk)));

    expect(stored.map(({ part }) => part.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
