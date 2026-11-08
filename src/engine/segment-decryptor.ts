import { fail, ok, type Result } from '../core/result.ts';
import type { HlsKey } from '../formats/hls-types.ts';
import type { FetchSegment } from './segment-fetcher.ts';

const KEY_BYTES = 16;
const AES_BLOCK = 16;
const SEQUENCE_BYTES = 8;

const BAD_KEY = 'The video is encrypted and its key could not be used.';
const CANNOT_DECRYPT = 'A part of the video could not be decrypted. The key may have expired; reload the page and try again.';

/** The part of `crypto.subtle` the decryptor uses. */
export interface SubtleLike {
  importKey(format: 'raw', keyData: Uint8Array<ArrayBuffer>, algorithm: 'AES-CBC', extractable: false, usages: ['decrypt']): Promise<CryptoKey>;
  decrypt(algorithm: { name: 'AES-CBC'; iv: Uint8Array<ArrayBuffer> }, key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
}

/** The IV a segment without an explicit one uses: its sequence number, big-endian, in 16 bytes. */
export function sequenceIv(sequence: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(AES_BLOCK);
  new DataView(iv.buffer).setBigUint64(AES_BLOCK - SEQUENCE_BYTES, BigInt(sequence));
  return iv;
}

/**
 * Decrypts HLS segments (AES-128, CBC, PKCS#7 padding), fetching each key
 * once. The key is requested with the user's cookies like any other part of
 * the stream.
 */
export class SegmentDecryptor {
  private readonly keys = new Map<string, CryptoKey>();
  private readonly fetchKey: (url: string) => Promise<Result<Uint8Array>>;
  private readonly subtle: SubtleLike;

  constructor(fetchKey: (url: string) => Promise<Result<Uint8Array>>, subtle: SubtleLike = crypto.subtle) {
    this.fetchKey = fetchKey;
    this.subtle = subtle;
  }

  /** Builds a decryptor that loads keys with the segment fetcher (retries, cookies) until `signal` aborts. */
  static withFetcher(fetchSegment: FetchSegment, signal: AbortSignal): SegmentDecryptor {
    return new SegmentDecryptor((url) => fetchSegment({ url }, signal));
  }

  async decrypt(data: Uint8Array, key: HlsKey, sequence: number): Promise<Result<Uint8Array>> {
    const cryptoKey = await this.keyFor(key.url);
    if (!cryptoKey.ok) {
      return cryptoKey;
    }

    if (data.length === 0 || data.length % AES_BLOCK !== 0) {
      return fail(CANNOT_DECRYPT);
    }

    try {
      const iv = key.iv === undefined ? sequenceIv(sequence) : new Uint8Array(key.iv);
      const plain = await this.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey.value, new Uint8Array(data));
      return ok(new Uint8Array(plain));
    } catch (error) {
      console.error('StreamDraft: could not decrypt a segment', error);
      return fail(CANNOT_DECRYPT);
    }
  }

  private async keyFor(url: string): Promise<Result<CryptoKey>> {
    const known = this.keys.get(url);
    if (known !== undefined) {
      return ok(known);
    }

    const bytes = await this.fetchKey(url);
    if (!bytes.ok) {
      return bytes;
    }
    if (bytes.value.length !== KEY_BYTES) {
      return fail(BAD_KEY);
    }

    try {
      const imported = await this.subtle.importKey('raw', new Uint8Array(bytes.value), 'AES-CBC', false, ['decrypt']);
      this.keys.set(url, imported);
      return ok(imported);
    } catch (error) {
      console.error('StreamDraft: could not use a segment key', error);
      return fail(BAD_KEY);
    }
  }
}
