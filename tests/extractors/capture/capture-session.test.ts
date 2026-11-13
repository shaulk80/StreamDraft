import { describe, expect, test } from 'vitest';
import { ENCRYPTED_MESSAGE } from '../../../src/engine/mp4/init-reader.ts';
import { CaptureSession } from '../../../src/extractors/capture/capture-session.ts';
import type { CaptureEvent } from '../../../src/extractors/capture/types.ts';
import { initSegment } from '../../engine/mp4-fixtures.ts';
import { AUDIO_TRACK, memorySink, secondSegment, trackStream, VIDEO_TRACK } from './stream-fixtures.ts';

const VIDEO_MIME = 'video/mp4; codecs="avc1.4d401e"';
const AUDIO_MIME = 'audio/mp4; codecs="mp4a.40.2"';

function appends(bufferId: number, chunks: readonly Uint8Array[], durationSeconds?: number): CaptureEvent[] {
  return chunks.map((bytes) => ({ kind: 'append', bufferId, bytes, durationSeconds }));
}

async function run(session: CaptureSession, events: readonly CaptureEvent[]): Promise<void> {
  for (const event of events) {
    await session.handle(event);
  }
}

/** A video of `seconds` seconds on buffer 1 (picture) and buffer 2 (sound), ending after `recorded` seconds. */
function playerEvents(seconds: number, recorded: number): CaptureEvent[] {
  return [
    { kind: 'buffer', bufferId: 1, sourceId: 1, mime: VIDEO_MIME },
    { kind: 'buffer', bufferId: 2, sourceId: 1, mime: AUDIO_MIME },
    ...appends(1, trackStream(VIDEO_TRACK, recorded), seconds),
    ...appends(2, trackStream(AUDIO_TRACK, recorded), seconds),
  ];
}

describe('CaptureSession', () => {
  test('a video recorded from start to end is complete', async () => {
    const { sink } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, playerEvents(6, 6));

    const snapshot = session.snapshot();
    expect(snapshot.complete).toBe(true);
    expect(snapshot.missing).toEqual([]);
    expect(snapshot.durationSeconds).toBe(6);
    expect(snapshot.buffers.map((buffer) => [buffer.kind, buffer.coveredSeconds])).toEqual([['video', 6], ['audio', 6]]);
    expect(snapshot.problems).toEqual([]);
  });

  test('a video recorded halfway shows what is missing', async () => {
    const { sink } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, playerEvents(10, 4));

    const snapshot = session.snapshot();
    expect(snapshot.complete).toBe(false);
    expect(snapshot.missing).toEqual([{ start: 4, end: 10 }]);
  });

  test('a stretch only one of the two buffers lacks is missing', async () => {
    const { sink } = memorySink();
    const session = new CaptureSession(sink);
    const events = playerEvents(5, 5).filter((event) => !(event.kind === 'append' && event.bufferId === 2 && event.bytes.length > 0 && isSegmentOfSecond(event, 3)));

    await run(session, events);

    expect(session.snapshot().missing).toEqual([{ start: 3, end: 4 }]);
  });

  test('is not complete while the length of the video is unknown', async () => {
    const { sink } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, [
      { kind: 'buffer', bufferId: 1, sourceId: 1, mime: VIDEO_MIME },
      ...appends(1, trackStream(VIDEO_TRACK, 3)),
    ]);

    expect(session.snapshot()).toMatchObject({ complete: false, missing: [], durationSeconds: undefined });
  });

  test.each([[Number.NaN], [Number.POSITIVE_INFINITY], [0], [-5]])('a length of %s is not a length', async (duration) => {
    const { sink } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, [{ kind: 'buffer', bufferId: 1, sourceId: 1, mime: VIDEO_MIME }, ...appends(1, trackStream(VIDEO_TRACK, 1), duration)]);

    expect(session.snapshot().durationSeconds).toBeUndefined();
  });

  test('encrypted media stops everything and is reported', async () => {
    const { sink, stored } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, [
      { kind: 'buffer', bufferId: 1, sourceId: 1, mime: VIDEO_MIME },
      ...appends(1, trackStream(VIDEO_TRACK, 1), 5),
      { kind: 'eme', api: 'setMediaKeys' },
      ...appends(1, [secondSegment(VIDEO_TRACK, 1)], 5),
    ]);

    const snapshot = session.snapshot();
    expect(snapshot).toMatchObject({ protected: true, complete: false });
    expect(snapshot.problems).toEqual([ENCRYPTED_MESSAGE]);
    expect(stored.filter(({ part }) => part.kind === 'fragment')).toHaveLength(1);
  });

  test('a buffer opened after encrypted media was seen is not recorded', async () => {
    const { sink, stored } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, [{ kind: 'eme', api: 'requestMediaKeySystemAccess' }, { kind: 'buffer', bufferId: 1, sourceId: 1, mime: VIDEO_MIME }, ...appends(1, trackStream(VIDEO_TRACK, 2), 2)]);

    expect(stored).toEqual([]);
    expect(session.snapshot().protected).toBe(true);
  });

  test('a format it cannot read is reported once and not recorded', async () => {
    const { sink, stored } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, [{ kind: 'buffer', bufferId: 1, sourceId: 1, mime: 'video/webm; codecs="vp9"' }, ...appends(1, [new Uint8Array(100)], 5)]);

    const snapshot = session.snapshot();
    expect(snapshot.problems).toHaveLength(1);
    expect(snapshot.problems[0]).toContain('video/webm');
    expect(snapshot.buffers[0]?.stoppedBecause).toBeDefined();
    expect(stored).toEqual([]);
  });

  test('a quality switch in one buffer is a problem and the capture is not complete', async () => {
    const { sink } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, [
      ...playerEvents(4, 2),
      ...appends(1, [initSegment([{ ...VIDEO_TRACK, timescale: 90_000 }]), secondSegment(VIDEO_TRACK, 2)], 4),
      ...appends(2, [secondSegment(AUDIO_TRACK, 2), secondSegment(AUDIO_TRACK, 3)], 4),
    ]);

    const snapshot = session.snapshot();
    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems).toHaveLength(1);
    expect(snapshot.problems[0]).toContain('changed the quality of the video');
  });

  test('only the newest media source is described, and the page is told that an older one was dropped', async () => {
    const { sink } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, [
      { kind: 'buffer', bufferId: 1, sourceId: 1, mime: VIDEO_MIME },
      ...appends(1, trackStream(VIDEO_TRACK, 2), 8),
      { kind: 'buffer', bufferId: 2, sourceId: 2, mime: VIDEO_MIME },
      ...appends(2, trackStream(VIDEO_TRACK, 5), 5),
    ]);

    const snapshot = session.snapshot();
    expect(snapshot.buffers.map((buffer) => buffer.bufferId)).toEqual([2]);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.problems).toEqual(['The page started another video. Only the newest one is recorded.']);
  });

  test('data for a buffer it was never told about is ignored', async () => {
    const { sink, stored } = memorySink();
    const session = new CaptureSession(sink);

    await run(session, appends(9, trackStream(VIDEO_TRACK, 1), 1));

    expect(stored).toEqual([]);
    expect(session.snapshot().buffers).toEqual([]);
  });

  test('events handled without waiting keep their order', async () => {
    const { sink } = memorySink();
    const session = new CaptureSession(sink);

    await Promise.all(playerEvents(3, 3).map((event) => session.handle(event)));

    expect(session.snapshot().complete).toBe(true);
  });
});

/** True when the append carries the segment that starts at `second` seconds (the fixtures start every segment on a whole second). */
function isSegmentOfSecond(event: CaptureEvent, second: number): boolean {
  return event.kind === 'append' && event.bytes.length === secondSegment(AUDIO_TRACK, second).length && bytesEqual(event.bytes, secondSegment(AUDIO_TRACK, second));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
