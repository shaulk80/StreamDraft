import { afterEach, describe, expect, test, vi } from 'vitest';
import { fail, ok, type Result } from '../../src/core/result.ts';
import { RecordingStore, type ReadUrl } from '../../src/engine/recording-store.ts';
import { recordingFixture } from './recording-fixtures.ts';

const NOT_READABLE = 'A part of the recording could not be read. The page may have removed it.';

function storeOf(options: { viaUrl: boolean }, readUrl?: ReadUrl) {
  const { recording, served } = recordingFixture(options);
  const reads: string[] = [];
  const reader: ReadUrl =
    readUrl ??
    ((url): Promise<Result<Uint8Array>> => {
      reads.push(url);
      const bytes = served.get(url);
      return Promise.resolve(bytes === undefined ? fail('The server answered 404.') : ok(bytes));
    });
  return { store: new RecordingStore(recording, reader), served, reads };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecordingStore', () => {
  test.each<[string, boolean, string]>([
    ['a File (Firefox)', false, 'v-0'],
    ['a blob address (Chrome)', true, 'v-0'],
  ])('reads a part by %s', async (_name, viaUrl, part) => {
    const { store, served } = storeOf({ viaUrl });
    const expected = viaUrl ? served.get(`blob:page/${part}`) : undefined;

    const read = await store.read(part);

    expect(read.ok).toBe(true);
    expect(read.ok && read.value.length).toBeGreaterThan(0);
    if (expected !== undefined) {
      expect(read.ok && read.value).toEqual(expected);
    }
  });

  test('fetches only the parts that are asked for, by their address', async () => {
    const { store, reads } = storeOf({ viaUrl: true });

    await store.read('a-1');

    expect(reads).toEqual(['blob:page/a-1']);
  });

  test.each<[string, boolean]>([
    ['by File', false],
    ['by address', true],
  ])('a part that is not there is an error, not an exception (%s)', async (_name, viaUrl) => {
    const { store } = storeOf({ viaUrl });

    expect(await store.read('nothing')).toEqual({ ok: false, error: NOT_READABLE });
  });

  test('an address the browser cannot read passes its reason on', async () => {
    const { store } = storeOf({ viaUrl: true }, () => Promise.resolve(fail('The connection failed or timed out.')));

    expect(await store.read('v-0')).toEqual({ ok: false, error: 'The connection failed or timed out.' });
  });

  test('a File that cannot be read is an error, and is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new RecordingStore(
      { buffers: [{ kind: 'video', init: { name: 'init', file: { size: 1, arrayBuffer: () => Promise.reject(new Error('gone')) } }, fragments: [] }] },
      () => Promise.resolve(fail('unused')),
    );

    expect(await store.read('init')).toEqual({ ok: false, error: NOT_READABLE });
    expect(log).toHaveBeenCalled();
  });

  test('a File knows its size, an address does not, a missing part has none', async () => {
    const byFile = storeOf({ viaUrl: false }).store;
    const byAddress = storeOf({ viaUrl: true }).store;
    const read = await byFile.read('v-0');

    expect(await byFile.size('v-0')).toBe(read.ok ? read.value.length : -1);
    expect(await byAddress.size('v-0')).toBeUndefined();
    expect(await byFile.size('nothing')).toBeUndefined();
  });

  test('is read only: writing fails and clearing leaves the page\'s files alone', async () => {
    const { store, reads } = storeOf({ viaUrl: true });

    expect(await store.write()).toEqual({ ok: false, error: 'A recording cannot be changed.' });
    expect(await store.clear()).toEqual({ ok: true, value: undefined });
    expect(reads).toEqual([]);
  });
});
