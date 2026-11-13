import { afterEach, describe, expect, test, vi } from 'vitest';
import { CAPTURE_DIRECTORY, OpfsPartSink, partFileName, STALE_AFTER_MS } from '../../../src/extractors/capture/part-store.ts';
import type { RecordedPart } from '../../../src/extractors/capture/types.ts';
import { FakeDirectory } from '../../engine/fake-opfs.ts';

const NOW = 1_800_000_000_000;

const INIT: RecordedPart = { kind: 'init', index: 0, bytes: new Uint8Array([1, 2, 3]) };
const FRAGMENT: RecordedPart = { kind: 'fragment', index: 1, bytes: new Uint8Array([4, 5, 6, 7]), startSeconds: 0, endSeconds: 4 };

function sinkOn(root: FakeDirectory, loadId = 'load1', now = NOW): OpfsPartSink {
  return new OpfsPartSink(() => Promise.resolve(root), () => now, loadId);
}

function captureFolder(root: FakeDirectory): FakeDirectory {
  const folder = root.directories.get(CAPTURE_DIRECTORY);
  if (folder === undefined) {
    throw new Error('no capture folder');
  }
  return folder;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('partFileName', () => {
  test.each<[string, number, RecordedPart, string]>([
    ['an init section', 3, INIT, 'b3-init'],
    ['the first segment', 1, FRAGMENT, 'b1-000001'],
    ['a late segment', 12, { ...FRAGMENT, index: 1234 }, 'b12-001234'],
  ])('names %s', (_name, bufferId, part, expected) => {
    expect(partFileName(bufferId, part)).toBe(expected);
  });
});

describe('OpfsPartSink', () => {
  test('stores each part as a file of its own in a folder of this load, and remembers where it lies in time', async () => {
    const root = new FakeDirectory();
    const sink = sinkOn(root);

    expect(await sink.store(1, INIT)).toEqual({ ok: true, value: undefined });
    expect(await sink.store(1, FRAGMENT)).toEqual({ ok: true, value: undefined });

    const folder = captureFolder(root).directories.get(`${NOW}-load1`);
    expect([...(folder?.files.keys() ?? [])]).toEqual(['b1-init', 'b1-000001']);
    expect(folder?.file('b1-000001')?.content).toEqual(FRAGMENT.bytes);
    expect(sink.records()).toEqual([
      { bufferId: 1, kind: 'init', index: 0, startSeconds: undefined, fileName: 'b1-init' },
      { bufferId: 1, kind: 'fragment', index: 1, startSeconds: 0, fileName: 'b1-000001' },
    ]);
  });

  test('reads a stored part back', async () => {
    const sink = sinkOn(new FakeDirectory());
    await sink.store(2, FRAGMENT);

    const file = await sink.file('b2-000001');

    expect(file.ok && new Uint8Array(await file.value.arrayBuffer())).toEqual(FRAGMENT.bytes);
  });

  test('a part that was never stored is an error, not an exception', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = sinkOn(new FakeDirectory());
    await sink.store(1, INIT);

    expect(await sink.file('nothing')).toEqual({ ok: false, error: 'A part of the recording could not be read.' });
  });

  test('says so when the file system is not available', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = new OpfsPartSink(() => Promise.reject(new Error('no storage')), () => NOW, 'load1');

    const stored = await sink.store(1, INIT);

    expect(!stored.ok && stored.error).toContain('could not be stored');
    expect(sink.records()).toEqual([]);
  });

  test('a write that fails is reported and not remembered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = new FakeDirectory();
    const sink = sinkOn(root);
    await sink.store(1, INIT);
    const folder = captureFolder(root).directories.get(`${NOW}-load1`);
    await folder?.getFileHandle('b1-000001', { create: true });
    const broken = folder?.file('b1-000001');
    if (broken !== undefined) {
      broken.failWith = new Error('disk full');
    }

    const stored = await sink.store(1, FRAGMENT);

    expect(stored.ok).toBe(false);
    expect(sink.records().map((record) => record.fileName)).toEqual(['b1-init']);
  });

  test('removes folders of earlier loads that are older than a day, and leaves recent ones alone', async () => {
    const root = new FakeDirectory();
    const captures = (await root.getDirectoryHandle(CAPTURE_DIRECTORY, { create: true })) as FakeDirectory;
    await captures.getDirectoryHandle(`${NOW - STALE_AFTER_MS - 1}-crashed`, { create: true });
    await captures.getDirectoryHandle(`${NOW - 60_000}-other-tab`, { create: true });
    await captures.getDirectoryHandle('not-ours', { create: true });

    await sinkOn(root).store(1, INIT);

    expect([...captures.directories.keys()].sort()).toEqual([`${NOW - 60_000}-other-tab`, `${NOW}-load1`, 'not-ours'].sort());
  });

  test('clear removes this load\'s folder and nothing else, and the sink can be used again', async () => {
    const root = new FakeDirectory();
    const captures = (await root.getDirectoryHandle(CAPTURE_DIRECTORY, { create: true })) as FakeDirectory;
    await captures.getDirectoryHandle(`${NOW - 1000}-other-tab`, { create: true });
    const sink = sinkOn(root);
    await sink.store(1, INIT);

    await sink.clear();

    expect([...captures.directories.keys()]).toEqual([`${NOW - 1000}-other-tab`]);
    expect(sink.records()).toEqual([]);
    expect((await sink.store(1, INIT)).ok).toBe(true);
    expect(captures.directories.has(`${NOW}-load1`)).toBe(true);
  });

  test('clear before anything was stored does nothing, and does not create a folder', async () => {
    const root = new FakeDirectory();

    await sinkOn(root).clear();

    expect(root.directories.size).toBe(0);
  });
});
