import { afterEach, describe, expect, test, vi } from 'vitest';
import { JOBS_DIRECTORY, OpfsSegmentStore } from '../../src/engine/opfs-store.ts';
import { FakeDirectory } from './fake-opfs.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

async function openStore(root: FakeDirectory, jobId = 'job-1'): Promise<OpfsSegmentStore> {
  const opened = await OpfsSegmentStore.open(root, jobId);
  if (!opened.ok) {
    throw new Error(opened.error);
  }
  return opened.value;
}

describe('OpfsSegmentStore', () => {
  test('writes and reads a segment back', async () => {
    const store = await openStore(new FakeDirectory());

    const written = await store.write('segment-000001', new Uint8Array([1, 2, 3]));
    const read = await store.read('segment-000001');

    expect(written).toEqual({ ok: true, value: 3 });
    expect(read).toEqual({ ok: true, value: new Uint8Array([1, 2, 3]) });
  });

  test('keeps each job in its own folder', async () => {
    const root = new FakeDirectory();
    const first = await openStore(root, 'job-1');
    const second = await openStore(root, 'job-2');

    await first.write('segment-000000', new Uint8Array(4));

    expect(await first.size('segment-000000')).toBe(4);
    expect(await second.size('segment-000000')).toBeUndefined();
  });

  test('reports a missing segment as having no size, without logging', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = await openStore(new FakeDirectory());

    expect(await store.size('segment-000009')).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  test('a failed write leaves no half segment behind', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = new FakeDirectory();
    const store = await openStore(root);
    await store.write('segment-000000', new Uint8Array([1]));
    const folder = root.directories.get(JOBS_DIRECTORY)?.directories.get('job-1');
    const file = folder?.file('segment-000000');
    if (file) {
      file.failWith = new DOMException('quota', 'QuotaExceededError');
    }

    const result = await store.write('segment-000000', new Uint8Array([9, 9]));

    expect(result).toEqual({ ok: false, error: 'A part of the video could not be stored. The disk may be full.' });
    expect(await store.read('segment-000000')).toEqual({ ok: true, value: new Uint8Array([1]) });
  });

  test('reading a segment that is not there fails with a message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = await openStore(new FakeDirectory());

    expect(await store.read('segment-000000')).toEqual({ ok: false, error: 'A stored part of the video could not be read.' });
  });

  test('clear removes the job folder, and clearing twice is fine', async () => {
    const root = new FakeDirectory();
    const store = await openStore(root);
    await store.write('segment-000000', new Uint8Array(1));

    const first = await store.clear();
    const second = await store.clear();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(root.directories.get(JOBS_DIRECTORY)?.directories.has('job-1')).toBe(false);
  });

  test.each([['../escape'], ['a/b'], [''], ['name with space']])('refuses the job name %j', async (jobId) => {
    const opened = await OpfsSegmentStore.open(new FakeDirectory(), jobId);

    expect(opened.ok).toBe(false);
  });

  test('says so when the file system is not available', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = new FakeDirectory();
    root.getDirectoryHandle = () => Promise.reject(new DOMException('denied', 'SecurityError'));

    const opened = await OpfsSegmentStore.open(root, 'job-1');

    expect(opened).toEqual({
      ok: false,
      error: 'The browser would not give the extension space to store the download. Private windows do not allow it.',
    });
  });
});
