import { describe, expect, test } from 'vitest';
import { parseHlsPlaylist } from '../../src/formats/hls.ts';
import { parseIv } from '../../src/formats/hls-key.ts';
import type { HlsMasterPlaylist, HlsMediaPlaylist } from '../../src/formats/hls-types.ts';
import {
  AES_MEDIA,
  BIPBOP_MASTER,
  BIPBOP_MEDIA,
  BYTE_RANGE_MEDIA,
  FMP4_MASTER,
  LIVE_MEDIA,
  MASTER_URL,
  MEDIA_URL,
  protectedMedia,
} from './hls-fixtures.ts';

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** Test helpers: a wrong kind or an error makes the test fail with the parser's own answer. */
function parseMaster(text: string): HlsMasterPlaylist {
  const result = parseHlsPlaylist(text, MASTER_URL);
  if (!result.ok || result.value.kind !== 'master') {
    expect.fail(`expected a master playlist: ${JSON.stringify(result)}`);
  }
  return result.value;
}

function parseMedia(text: string): HlsMediaPlaylist {
  const result = parseHlsPlaylist(text, MEDIA_URL);
  if (!result.ok || result.value.kind !== 'media') {
    expect.fail(`expected a media playlist: ${JSON.stringify(result)}`);
  }
  return result.value;
}

describe('master playlist', () => {
  test('lists the renditions with absolute addresses and their codecs', () => {
    const master = parseMaster(BIPBOP_MASTER);

    expect(master.variants.map((variant) => variant.variantId)).toEqual([
      'https://cdn.example.com/video/gear1/prog_index.m3u8',
      'https://cdn.example.com/video/gear3/prog_index.m3u8',
      'https://cdn.example.com/video/gear0/prog_index.m3u8',
    ]);
    expect(master.variants[1]).toMatchObject({ bandwidth: 991714, codecs: 'mp4a.40.2, avc1.4d401e' });
  });

  test.each([
    ['gear1/prog_index.m3u8', undefined],
    ['gear0/prog_index.m3u8', true],
  ])('audio-only flag of %s', (path, expected) => {
    const master = parseMaster(BIPBOP_MASTER);
    const variant = master.variants.find((candidate) => candidate.variantId.endsWith(path));

    expect(variant?.audioOnly).toBe(expected);
  });

  test('reads resolution, frame rate and the average bit rate', () => {
    const master = parseMaster(FMP4_MASTER);
    const full = master.variants.find((variant) => variant.variantId.endsWith('v9/prog_index.m3u8'));

    expect(full).toMatchObject({ width: 1920, height: 1080, frameRate: 60, bandwidth: 7968416, audioGroupId: 'aud1' });
  });

  test('counts a playlist listed for two audio groups once, first one wins', () => {
    const master = parseMaster(FMP4_MASTER);
    const shared = master.variants.filter((variant) => variant.variantId.endsWith('v5/prog_index.m3u8'));

    expect(master.variants).toHaveLength(2);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.audioGroupId).toBe('aud1');
  });

  test('lists audio tracks only, with their playlists', () => {
    const master = parseMaster(FMP4_MASTER);

    expect(master.audioRenditions).toEqual([
      { groupId: 'aud1', name: 'English', language: 'en', isDefault: true, url: 'https://cdn.example.com/video/a1/prog_index.m3u8' },
      { groupId: 'aud2', name: 'English', language: 'en', isDefault: true, url: 'https://cdn.example.com/video/a2/prog_index.m3u8' },
    ]);
  });

  test('tolerates a byte order mark and Windows line ends', () => {
    const text = `${BYTE_ORDER_MARK}${BIPBOP_MASTER.replaceAll('\n', '\r\n')}`;

    expect(parseMaster(text).variants).toHaveLength(3);
  });
});

describe('media playlist', () => {
  test('lists segments with addresses, lengths and sequence numbers', () => {
    const playlist = parseMedia(BIPBOP_MEDIA);

    expect(playlist.segments.map((segment) => segment.url)).toEqual([
      'https://cdn.example.com/video/gear3/fileSequence0.ts',
      'https://cdn.example.com/video/gear3/fileSequence1.ts',
      'https://cdn.example.com/video/gear3/fileSequence2.ts',
    ]);
    expect(playlist.segments.map((segment) => segment.sequence)).toEqual([0, 1, 2]);
    expect(playlist.totalDurationSeconds).toBeCloseTo(29.93, 2);
    expect(playlist).toMatchObject({ targetDurationSeconds: 10, live: false });
  });

  test.each([
    ['a playlist with an end marker', BIPBOP_MEDIA, false],
    ['a playlist without one', LIVE_MEDIA, true],
  ])('live flag of %s', (_name, text, live) => {
    expect(parseMedia(text).live).toBe(live);
  });

  test('numbers segments from the media sequence', () => {
    const playlist = parseMedia(LIVE_MEDIA);

    expect(playlist.segments.map((segment) => segment.sequence)).toEqual([2680, 2681]);
  });

  test('places byte ranges, continuing a range that has no offset', () => {
    const playlist = parseMedia(BYTE_RANGE_MEDIA);

    expect(playlist.segments.map((segment) => segment.byteRange)).toEqual([
      { offset: 720, length: 50000 },
      { offset: 50720, length: 48000 },
      undefined,
    ]);
  });

  test('gives each segment the init section and discontinuity in force at its start', () => {
    const playlist = parseMedia(BYTE_RANGE_MEDIA);
    const [first, second, third] = playlist.segments;

    expect(first?.init).toEqual({ url: 'https://cdn.example.com/video/gear3/main.mp4', byteRange: { offset: 0, length: 720 } });
    expect(second?.init).toEqual(first?.init);
    expect(third?.init).toEqual({ url: 'https://cdn.example.com/video/gear3/init2.mp4' });
    expect(playlist.segments.map((segment) => segment.discontinuity)).toEqual([false, false, true]);
  });
});

describe('AES-128', () => {
  test('attaches the key in force to each segment and drops it at METHOD=NONE', () => {
    const playlist = parseMedia(AES_MEDIA);
    const [first, second, third] = playlist.segments;

    expect(first?.key?.url).toBe('https://cdn.example.com/video/gear3/keys/one.key');
    expect(first?.key?.iv).toEqual(Uint8Array.from({ length: 16 }, (_unused, index) => index));
    expect(second?.key).toEqual({ url: 'https://keys.example.net/two.key' });
    expect(third?.key).toBeUndefined();
    expect(playlist.segments.map((segment) => segment.sequence)).toEqual([7, 8, 9]);
  });

  test.each([
    ['0x01', '00000000000000000000000000000001'],
    ['0X0000000000000000000000000000FF10', '0000000000000000000000000000ff10'],
  ])('reads the IV %s', (text, expectedHex) => {
    const iv = parseIv(text);

    expect(Array.from(iv ?? [], (byte) => byte.toString(16).padStart(2, '0')).join('')).toBe(expectedHex);
  });

  test.each(['', '0x', '0xZZ', '00ff', `0x${'1'.repeat(33)}`])('rejects the IV "%s"', (text) => {
    expect(parseIv(text)).toBeUndefined();
  });
});

describe('protected streams', () => {
  test.each([
    ['SAMPLE-AES', '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key",KEYFORMAT="identity"', 'Sample-AES encryption'],
    ['SAMPLE-AES-CTR', '#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:text/plain;base64,AAAA"', 'Sample-AES encryption'],
    ['FairPlay', '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key",KEYFORMAT="com.apple.streamingkeydelivery"', 'FairPlay DRM'],
    ['Widevine', '#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:;base64,AA",KEYFORMAT="urn:uuid:EDEF8BA9-79D6-4ACE-A3C8-27DCD51D21ED"', 'Widevine DRM'],
    ['PlayReady', '#EXT-X-KEY:METHOD=AES-128,URI="https://k/x",KEYFORMAT="com.microsoft.playready"', 'PlayReady DRM'],
    ['unknown format', '#EXT-X-KEY:METHOD=AES-128,URI="https://k/x",KEYFORMAT="com.example.secret"', 'DRM protection'],
  ])('media playlist with %s is reported and lists no segments', (_name, keyTag, reason) => {
    const playlist = parseMedia(protectedMedia(keyTag));

    expect(playlist.protectedReason).toBe(reason);
    expect(playlist.segments).toEqual([]);
  });

  test('a session key marks the master playlist', () => {
    const text = `${BIPBOP_MASTER}#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"\n`;

    expect(parseMaster(text).protectedReason).toBe('FairPlay DRM');
  });

  test('a plain AES-128 key is not protection', () => {
    expect(parseMedia(AES_MEDIA).protectedReason).toBeUndefined();
  });
});

describe('errors', () => {
  test.each([
    ['text that is not a playlist', '<html>Forbidden</html>', 'Not an HLS playlist.'],
    ['an empty text', '', 'Not an HLS playlist.'],
    ['a media playlist without segments', '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-ENDLIST\n', 'The playlist lists no segments.'],
    ['a master playlist without renditions', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n', 'The playlist lists no renditions.'],
    ['a key-frame-only playlist', '#EXTM3U\n#EXT-X-I-FRAMES-ONLY\n#EXTINF:2.0,\na.ts\n', 'Playlists of key frames only cannot be downloaded.'],
    ['a segment without a length', '#EXTM3U\nseg.ts\n', 'The segment seg.ts has no length.'],
    ['a bad segment length', '#EXTM3U\n#EXTINF:abc,\nseg.ts\n', 'Bad segment length: abc,'],
    ['a bad IV', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k",IV=0xZZ\n#EXTINF:1,\na.ts\n', 'Bad initialisation vector: 0xZZ'],
    ['an AES key without an address', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128\n#EXTINF:1,\na.ts\n', 'An AES-128 key has no address.'],
    ['an unknown method', '#EXTM3U\n#EXT-X-KEY:METHOD=ROT13,URI="k"\n#EXTINF:1,\na.ts\n', 'Unknown encryption method: ROT13'],
    ['a key tag without a method', '#EXTM3U\n#EXT-X-KEY:URI="k"\n#EXTINF:1,\na.ts\n', 'An encryption tag has no method.'],
    ['a byte range that cannot be placed', '#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:100\na.ts\n', 'A byte range without a start does not follow another range: 100'],
    ['an init section without an address', '#EXTM3U\n#EXT-X-MAP:BYTERANGE="10@0"\n#EXTINF:1,\na.ts\n', 'Bad initialisation section address: (none)'],
  ])('%s gives an error', (_name, text, message) => {
    const result = parseHlsPlaylist(text, MEDIA_URL);

    expect(result).toEqual({ ok: false, error: message });
  });

  test('an invalid playlist address gives an error', () => {
    const result = parseHlsPlaylist(BIPBOP_MEDIA, 'not an address');

    expect(result.ok).toBe(false);
  });
});
