import { describe, expect, test } from 'vitest';
import { isPartOf } from '../../src/core/stream-parts.ts';
import { parseDashManifest } from '../../src/formats/dash.ts';
import { parseHlsPlaylist } from '../../src/formats/hls.ts';
import { summarizeDash, summarizeHls } from '../../src/formats/stream-summary.ts';
import { LIST_MANIFEST, MANIFEST_URL, protectedManifest, TEMPLATE_MANIFEST } from './dash-fixtures.ts';
import {
  BIPBOP_MASTER,
  BIPBOP_MEDIA,
  FMP4_MASTER,
  LIVE_MEDIA,
  MASTER_URL,
  MEDIA_URL,
  protectedMedia,
} from './hls-fixtures.ts';

function hls(text: string, url: string) {
  const parsed = parseHlsPlaylist(text, url);
  if (!parsed.ok) {
    throw new Error(`fixture does not parse: ${parsed.error}`);
  }
  return summarizeHls(parsed.value);
}

function dash(text: string) {
  const parsed = parseDashManifest(text, MANIFEST_URL);
  if (!parsed.ok) {
    throw new Error(`fixture does not parse: ${parsed.error}`);
  }
  return summarizeDash(parsed.value);
}

describe('summarizeHls: master playlist', () => {
  test('one quality per height, best first, and audio last', () => {
    const result = hls(FMP4_MASTER, MASTER_URL);

    expect(result.ok && result.value.qualities.map((option) => [option.quality, option.label])).toEqual([
      ['1080p', '1080p60'],
      ['480p', '540p60'],
      ['audio', 'Audio only'],
    ]);
  });

  test('the renditions are its parts, so they are not listed as streams of their own', () => {
    const result = hls(FMP4_MASTER, MASTER_URL);

    expect(result.ok && result.value.partUrls).toEqual(
      expect.arrayContaining([
        'https://cdn.example.com/video/v5/prog_index.m3u8',
        'https://cdn.example.com/video/v9/prog_index.m3u8',
        'https://cdn.example.com/video/a1/prog_index.m3u8',
      ]),
    );
  });

  test('an audio-only rendition is offered as the audio option', () => {
    const result = hls(BIPBOP_MASTER, MASTER_URL);

    const audio = result.ok ? result.value.qualities.find((option) => option.quality === 'audio') : undefined;
    expect(audio?.variant).toMatchObject({ variantId: 'https://cdn.example.com/video/gear0/prog_index.m3u8', audioOnly: true });
  });

  test('the stored renditions carry no segment lists or other bulk', () => {
    const result = hls(BIPBOP_MASTER, MASTER_URL);

    const keys = result.ok ? Object.keys(result.value.qualities[0]?.variant ?? {}) : [];
    expect(keys.every((key) => ['variantId', 'bandwidth', 'width', 'height', 'codecs', 'frameRate', 'audioOnly'].includes(key))).toBe(true);
  });
});

describe('summarizeHls: media playlist', () => {
  test('a playlist on its own is one rendition: itself', () => {
    const result = hls(BIPBOP_MEDIA, MEDIA_URL);

    expect(result.ok && result.value.qualities.map((option) => [option.quality, option.variant?.variantId])).toEqual([
      ['best', MEDIA_URL],
      ['audio', MEDIA_URL],
    ]);
  });

  test('its segments are its parts, kept as a few runs', () => {
    const result = hls(BIPBOP_MEDIA, MEDIA_URL);

    expect(result.ok && result.value.partRuns?.length).toBeGreaterThan(0);
    expect(result.ok && result.value.partRuns?.length).toBeLessThan(5);
    expect(result.ok && isPartOf(result.value, 'https://cdn.example.com/video/gear3/fileSequence7.ts')).toBe(true);
    expect(result.ok && isPartOf(result.value, MEDIA_URL)).toBe(false);
  });

  test('a live playlist gives an error', () => {
    const result = hls(LIVE_MEDIA, MEDIA_URL);

    expect(!result.ok && result.error).toContain('Live');
  });
});

describe('summarizeHls: protected', () => {
  test.each([
    ['a media playlist', protectedMedia('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key",KEYFORMAT="com.apple.streamingkeydelivery"'), MEDIA_URL],
    ['a master playlist', '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://key",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nv.m3u8\n', MASTER_URL],
  ])('%s is protected, with the reason and no qualities', (_name, text, url) => {
    const result = hls(text, url);

    expect(result).toMatchObject({ ok: true, value: { protected: true, protectedReason: 'FairPlay DRM', qualities: [] } });
  });
});

describe('summarizeDash', () => {
  test('video heights and audio, with sizes from the bit rate and the length', () => {
    const result = dash(TEMPLATE_MANIFEST);

    const qualities = result.ok ? result.value.qualities : [];
    expect(qualities.at(-1)).toMatchObject({ quality: 'audio', label: 'Audio only' });
    expect(qualities.length).toBeGreaterThan(1);
    expect(qualities[0]?.sizeBytes).toBeGreaterThan(0);
  });

  test('a manifest with a segment list works too', () => {
    expect(dash(LIST_MANIFEST).ok).toBe(true);
  });

  test('its segments are its parts, the manifest itself is not', () => {
    const result = dash(TEMPLATE_MANIFEST);

    expect(result.ok && isPartOf(result.value, 'https://cdn.example.com/dash/bbb_30fps_1920x1080_8000k/bbb_30fps_1920x1080_8000k_32.m4v')).toBe(true);
    expect(result.ok && isPartOf(result.value, MANIFEST_URL)).toBe(false);
  });

  test('a live manifest gives an error', () => {
    const result = dash(TEMPLATE_MANIFEST.replace('type="static"', 'type="dynamic"'));

    expect(!result.ok && result.error).toContain('Live');
  });

  test('a protected manifest is protected, with the reason and no qualities', () => {
    const result = dash(protectedManifest('<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>'));

    expect(result).toMatchObject({ ok: true, value: { protected: true, protectedReason: 'Widevine DRM', qualities: [] } });
  });

  test('a protected manifest still names its segment files, so a player\'s requests for them are not listed', () => {
    const result = dash(
      protectedManifest('<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>').replace('s$Number$.m4s', 's$Number$.mp4'),
    );

    expect(result.ok && isPartOf(result.value, 'https://cdn.example.com/dash/s3.mp4')).toBe(true);
    expect(result.ok && isPartOf(result.value, 'https://cdn.example.com/dash/init.mp4')).toBe(true);
  });
});
