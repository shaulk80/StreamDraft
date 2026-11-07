import { fail, ok, type Result } from '../core/result.ts';
import { protectionName, UNKNOWN_PROTECTION } from './drm.ts';
import { parseAttributeList } from './hls-lines.ts';
import type { HlsKey } from './hls-types.ts';
import { resolveUrl } from './resolve-url.ts';

/** What a `#EXT-X-KEY` or `#EXT-X-SESSION-KEY` tag means for the segments that follow it. */
export type KeyOutcome =
  | { kind: 'none' }
  | { kind: 'aes'; key: HlsKey }
  | { kind: 'protected'; reason: string };

const IDENTITY_KEY_FORMAT = 'identity';
const SAMPLE_AES_PREFIX = 'SAMPLE-AES';
const SAMPLE_AES_PROTECTION = 'Sample-AES encryption';
const IV_PATTERN = /^0x([0-9a-f]{1,32})$/i;
const IV_HEX_DIGITS = 32;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

/** `0x...` as 16 bytes (short values are padded on the left), or undefined when it is not one. */
export function parseIv(text: string): Uint8Array | undefined {
  const match = IV_PATTERN.exec(text);
  const digits = match?.[1];
  if (digits === undefined) {
    return undefined;
  }

  const padded = digits.padStart(IV_HEX_DIGITS, '0');
  const bytes = new Uint8Array(IV_HEX_DIGITS / HEX_DIGITS_PER_BYTE);
  for (let index = 0; index < bytes.length; index += 1) {
    const start = index * HEX_DIGITS_PER_BYTE;
    bytes[index] = Number.parseInt(padded.slice(start, start + HEX_DIGITS_PER_BYTE), HEX_RADIX);
  }
  return bytes;
}

/**
 * Reads the attributes of a key tag. Only plain AES-128 with the identity key
 * format is something we can decrypt; SAMPLE-AES and every DRM key format come
 * back as `protected` and are never downloaded.
 */
export function parseKeyTag(value: string, playlistUrl: string): Result<KeyOutcome> {
  const attributes = parseAttributeList(value);
  const method = attributes.get('METHOD');
  if (method === undefined) {
    return fail('An encryption tag has no method.');
  }
  if (method === 'NONE') {
    return ok({ kind: 'none' });
  }

  const keyFormat = attributes.get('KEYFORMAT') ?? IDENTITY_KEY_FORMAT;
  if (keyFormat.toLowerCase() !== IDENTITY_KEY_FORMAT) {
    return ok({ kind: 'protected', reason: protectionName(keyFormat) ?? UNKNOWN_PROTECTION });
  }
  if (method.startsWith(SAMPLE_AES_PREFIX)) {
    return ok({ kind: 'protected', reason: SAMPLE_AES_PROTECTION });
  }
  if (method !== 'AES-128') {
    return fail(`Unknown encryption method: ${method}`);
  }

  return buildAesKey(attributes, playlistUrl);
}

function buildAesKey(attributes: ReadonlyMap<string, string>, playlistUrl: string): Result<KeyOutcome> {
  const reference = attributes.get('URI');
  if (reference === undefined) {
    return fail('An AES-128 key has no address.');
  }

  const url = resolveUrl(reference, playlistUrl);
  if (url === undefined) {
    return fail(`Bad key address: ${reference}`);
  }

  const ivText = attributes.get('IV');
  if (ivText === undefined) {
    return ok({ kind: 'aes', key: { url } });
  }

  const iv = parseIv(ivText);
  if (iv === undefined) {
    return fail(`Bad initialisation vector: ${ivText}`);
  }
  return ok({ kind: 'aes', key: { url, iv } });
}
