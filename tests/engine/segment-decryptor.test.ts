import { afterEach, describe, expect, test, vi } from 'vitest';
import { fail, ok } from '../../src/core/result.ts';
import { SegmentDecryptor, sequenceIv } from '../../src/engine/segment-decryptor.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const KEY = new Uint8Array(16).map((_unused, index) => index + 1);
const OTHER_KEY = new Uint8Array(16).map((_unused, index) => 200 - index);
const KEY_URL = 'https://cdn.example.com/key.bin';
const PLAIN = new Uint8Array(100).map((_unused, index) => (index * 7) & 0xff);

async function encrypt(plain: Uint8Array, key: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-CBC', false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(iv) }, imported, new Uint8Array(plain)));
}

function decryptorWith(key: Uint8Array = KEY) {
  const fetchKey = vi.fn<(url: string) => Promise<ReturnType<typeof ok<Uint8Array>>>>(() => Promise.resolve(ok(key)));
  return { fetchKey, decryptor: new SegmentDecryptor(fetchKey) };
}

describe('sequenceIv', () => {
  test.each([
    [0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    [5, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5]],
    [258, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]],
  ])('sequence %i is a big-endian number in 16 bytes', (sequence, expected) => {
    expect(Array.from(sequenceIv(sequence))).toEqual(expected);
  });
});

describe('SegmentDecryptor', () => {
  test('decrypts with the IV the playlist states', async () => {
    const iv = new Uint8Array(16).fill(9);
    const { decryptor } = decryptorWith();

    const result = await decryptor.decrypt(await encrypt(PLAIN, KEY, iv), { url: KEY_URL, iv }, 3);

    expect(result).toEqual(ok(PLAIN));
  });

  test('decrypts with the sequence number as IV when the playlist states none', async () => {
    const { decryptor } = decryptorWith();

    const result = await decryptor.decrypt(await encrypt(PLAIN, KEY, sequenceIv(42)), { url: KEY_URL }, 42);

    expect(result).toEqual(ok(PLAIN));
  });

  test('fetches a key once for all the segments that use it', async () => {
    const { decryptor, fetchKey } = decryptorWith();

    await decryptor.decrypt(await encrypt(PLAIN, KEY, sequenceIv(1)), { url: KEY_URL }, 1);
    await decryptor.decrypt(await encrypt(PLAIN, KEY, sequenceIv(2)), { url: KEY_URL }, 2);

    expect(fetchKey).toHaveBeenCalledTimes(1);
    expect(fetchKey).toHaveBeenCalledWith(KEY_URL);
  });

  test('passes on a key that could not be fetched', async () => {
    const decryptor = new SegmentDecryptor(() => Promise.resolve(fail('The server answered 403.')));

    expect(await decryptor.decrypt(new Uint8Array(16), { url: KEY_URL }, 0)).toEqual(fail('The server answered 403.'));
  });

  test('rejects a key that is not 16 bytes', async () => {
    const { decryptor } = decryptorWith(new Uint8Array(8));

    expect(await decryptor.decrypt(new Uint8Array(16), { url: KEY_URL }, 0)).toEqual(fail('The video is encrypted and its key could not be used.'));
  });

  test('rejects data that is not whole blocks', async () => {
    const { decryptor } = decryptorWith();

    const result = await decryptor.decrypt(new Uint8Array(20), { url: KEY_URL }, 0);

    expect(result.ok).toBe(false);
  });

  test('reports a wrong key in plain words', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { decryptor } = decryptorWith(OTHER_KEY);

    const result = await decryptor.decrypt(await encrypt(PLAIN, KEY, sequenceIv(0)), { url: KEY_URL }, 0);

    expect(result).toEqual(fail('A part of the video could not be decrypted. The key may have expired; reload the page and try again.'));
  });
});
