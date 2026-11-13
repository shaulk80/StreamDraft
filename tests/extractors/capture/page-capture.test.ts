import { describe, expect, test, vi } from 'vitest';
import { OpfsPartSink } from '../../../src/extractors/capture/part-store.ts';
import { PageCapture, recordingProblem, type PartAddresses } from '../../../src/extractors/capture/page-capture.ts';
import type { CaptureEvent, CaptureSnapshot } from '../../../src/extractors/capture/types.ts';
import { FakeDirectory } from '../../engine/fake-opfs.ts';
import { AUDIO_TRACK, secondSegment, trackStream, VIDEO_TRACK } from './stream-fixtures.ts';

const VIDEO_MIME = 'video/mp4; codecs="avc1.4d401e"';
const AUDIO_MIME = 'audio/mp4; codecs="mp4a.40.2"';
const NOW = 1_800_000_000_000;

function player(seconds: number, recorded: number, mime = VIDEO_MIME): CaptureEvent[] {
  const append = (bufferId: number, parts: Uint8Array[]): CaptureEvent[] => parts.map((bytes) => ({ kind: 'append', bufferId, bytes, durationSeconds: seconds }));
  return [
    { kind: 'buffer', bufferId: 1, sourceId: 1, mime },
    { kind: 'buffer', bufferId: 2, sourceId: 1, mime: AUDIO_MIME },
    ...append(1, trackStream(VIDEO_TRACK, recorded)),
    ...append(2, trackStream(AUDIO_TRACK, recorded)),
  ];
}

function setup(addresses?: PartAddresses) {
  const root = new FakeDirectory();
  const sink = new OpfsPartSink(() => Promise.resolve(root), () => NOW, 'load1');
  return { capture: new PageCapture(sink, addresses), root, sink };
}

function feed(capture: PageCapture, events: readonly CaptureEvent[]): void {
  events.forEach((event) => capture.handle(event));
}

describe('PageCapture', () => {
  test('a complete recording is handed over as Files, init section first, segments in time order', async () => {
    const { capture } = setup();
    feed(capture, player(3, 3));

    const saved = await capture.save();

    expect(saved.ok).toBe(true);
    const buffers = saved.ok ? saved.value.buffers : [];
    expect(buffers.map((buffer) => buffer.kind)).toEqual(['video', 'audio']);
    expect(buffers[0]?.init.name).toBe('b1-init');
    expect(buffers[0]?.fragments.map((part) => [part.name, part.startSeconds])).toEqual([
      ['b1-000001', 0],
      ['b1-000002', 1],
      ['b1-000003', 2],
    ]);
    expect(buffers[0]?.fragments.every((part) => part.file !== undefined && part.url === undefined)).toBe(true);
    const first = buffers[0]?.fragments[0]?.file;
    expect(first && new Uint8Array(await first.arrayBuffer())).toEqual(secondSegment(VIDEO_TRACK, 0));
  });

  test('where Files cannot travel, every part gets an address, and discard gives them back and removes the files', async () => {
    const released: string[] = [];
    const { capture, root } = setup({
      address: (file) => `blob:page/${file.size}-${released.length + Math.random()}`,
      release: (url) => released.push(url),
    });
    feed(capture, player(2, 2));

    const saved = await capture.save();

    const parts = saved.ok ? saved.value.buffers.flatMap((buffer) => [buffer.init, ...buffer.fragments]) : [];
    expect(parts).toHaveLength(6);
    expect(parts.every((part) => part.url?.startsWith('blob:page/') === true && part.file === undefined)).toBe(true);

    await capture.discard();

    expect(released).toEqual(parts.map((part) => part.url));
    expect([...(root.directories.get('streamdraft-capture')?.directories.values() ?? [])]).toEqual([]);
  });

  test('after discard the status shows nothing recorded, and later appends of the old buffers are not recorded', async () => {
    const { capture } = setup();
    feed(capture, player(3, 3));
    await capture.discard();

    feed(capture, [{ kind: 'append', bufferId: 1, bytes: secondSegment(VIDEO_TRACK, 0), durationSeconds: 3 }]);
    const status = await capture.status();

    expect(status).toMatchObject({ complete: false, buffers: [] });
  });

  test('status waits for what the player already appended', async () => {
    const { capture } = setup();
    feed(capture, player(3, 3));

    const status = await capture.status();

    expect(status).toMatchObject({ complete: true, durationSeconds: 3 });
  });

  test.each<[string, (events: CaptureEvent[]) => CaptureEvent[], string]>([
    ['nothing was recorded', () => [], 'Nothing was recorded'],
    ['the video is only partly recorded', () => player(10, 4), 'Parts of the video are missing (0:04 to 0:10)'],
    ['the player used encrypted media', (events) => [...events, { kind: 'eme', api: 'setMediaKeys' }], 'protected'],
    ['a format that cannot be saved', () => player(3, 3, 'video/webm; codecs="vp9"'), 'cannot save'],
  ])('refuses to save when %s', async (_name, events, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { capture } = setup();
    feed(capture, events(player(3, 3)));

    const saved = await capture.save();

    expect(!saved.ok && saved.error).toContain(message);
  });

  test('a recording that could not be stored is not saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = new OpfsPartSink(() => Promise.reject(new Error('no storage')), () => NOW, 'load1');
    const capture = new PageCapture(sink);
    feed(capture, player(3, 3));

    const saved = await capture.save();

    expect(!saved.ok && saved.error).toContain('could not be stored');
  });
});

describe('recordingProblem', () => {
  const COMPLETE: CaptureSnapshot = {
    protected: false,
    durationSeconds: 5,
    buffers: [{ bufferId: 1, sourceId: 1, mime: VIDEO_MIME, kind: 'video', initStored: true, fragmentCount: 5, duplicateCount: 0, covered: [{ start: 0, end: 5 }], coveredSeconds: 5 }],
    missing: [],
    problems: [],
    complete: true,
  };

  test.each<[string, Partial<CaptureSnapshot>, string | undefined]>([
    ['a complete recording', {}, undefined],
    ['an unknown length', { durationSeconds: undefined, complete: false }, 'has not said how long'],
    ['many gaps are summed up', { missing: [1, 2, 3, 4].map((start) => ({ start, end: start + 0.5 })), complete: false }, '0:01 to 0:01, 0:02 to 0:02, 0:03 to 0:03 and more'],
    ['an incomplete recording with no reason', { complete: false }, 'not complete yet'],
  ])('%s', (_name, change, message) => {
    const problem = recordingProblem({ ...COMPLETE, ...change });

    if (message === undefined) {
      expect(problem).toBeUndefined();
    } else {
      expect(problem).toContain(message);
    }
  });
});
