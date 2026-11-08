import { afterEach, describe, expect, test, vi } from 'vitest';
import { OpfsSegmentStore } from '../../src/engine/opfs-store.ts';
import { OpfsOutputSink } from '../../src/engine/opfs-sink.ts';
import { FakeDirectory } from './fake-opfs.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

async function openSink(folder = new FakeDirectory()) {
  const opened = await OpfsOutputSink.open(folder, 'video.mp4');
  if (!opened.ok) {
    throw new Error(opened.error);
  }
  return { sink: opened.value, folder };
}

async function committedBytes(sink: OpfsOutputSink): Promise<Uint8Array> {
  const file = await sink.file();
  return file.ok ? new Uint8Array(await file.value.arrayBuffer()) : new Uint8Array(0);
}

describe('OpfsOutputSink', () => {
  test('appends in order, counts the position and commits on close', async () => {
    const { sink } = await openSink();

    await sink.append(new Uint8Array([1, 2, 3]));
    await sink.append(new Uint8Array([4, 5]));
    expect(sink.position).toBe(5);
    expect(await committedBytes(sink)).toEqual(new Uint8Array(0));

    expect((await sink.close()).ok).toBe(true);
    expect(await committedBytes(sink)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  test('patches bytes already written', async () => {
    const { sink } = await openSink();
    await sink.append(new Uint8Array([0, 0, 0, 0, 9, 9]));

    await sink.patch(1, new Uint8Array([7, 7]));
    await sink.close();

    expect(await committedBytes(sink)).toEqual(new Uint8Array([0, 7, 7, 0, 9, 9]));
  });

  test('abort leaves no committed file content', async () => {
    const { sink } = await openSink();
    await sink.append(new Uint8Array([1, 2, 3]));

    await sink.abort();

    expect(await committedBytes(sink)).toEqual(new Uint8Array(0));
  });

  test('reports a write the disk refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { sink, folder } = await openSink();
    const file = folder.file('video.mp4');
    if (file) {
      file.failWith = new DOMException('quota', 'QuotaExceededError');
    }

    expect(await sink.append(new Uint8Array(4))).toEqual({
      ok: false,
      error: 'The finished video could not be written. The disk may be full.',
    });
    expect(sink.position).toBe(0);
  });

  test('is created inside the job folder of a segment store, so clearing the job removes it', async () => {
    const root = new FakeDirectory();
    const opened = await OpfsSegmentStore.open(root, 'job-1');
    if (!opened.ok) {
      throw new Error(opened.error);
    }

    const output = await opened.value.createOutput('video.mp4');
    await opened.value.clear();

    expect(output.ok).toBe(true);
    expect([...root.directories.values()].every((jobs) => jobs.directories.size === 0)).toBe(true);
  });
});
