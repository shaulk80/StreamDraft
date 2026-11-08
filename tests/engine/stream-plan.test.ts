import { describe, expect, test } from 'vitest';
import type { MediaItem, QualityOption, StreamVariant } from '../../src/core/media.ts';
import { fail, ok } from '../../src/core/result.ts';
import type { FetchText } from '../../src/detect/manifest-fetch.ts';
import { segmentName } from '../../src/engine/segment-job.ts';
import { assemblePlan, planStream } from '../../src/engine/stream-plan.ts';

const CDN = 'https://cdn.example.com/show';

const HLS_MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,URI="audio/a.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"
v360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
v720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"
audio-only.m3u8
`;

const TS_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:7
#EXTINF:4,
seg0.ts
#EXTINF:4,
seg1.ts
#EXT-X-ENDLIST
`;

const FMP4_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
#EXT-X-BYTERANGE:1000@0
media.mp4
#EXTINF:4,
#EXT-X-BYTERANGE:1200@1000
media.mp4
#EXT-X-ENDLIST
`;

const ENCRYPTED_PLAYLIST = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:3
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:4,
seg0.ts
#EXTINF:4,
seg1.ts
#EXT-X-ENDLIST
`;

const AAC_PLAYLIST = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4,
a0.aac
#EXTINF:4,
a1.aac
#EXT-X-ENDLIST
`;

const LIVE_PLAYLIST = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4,
seg0.ts
`;

const CHANGING_INIT_PLAYLIST = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="init1.mp4"
#EXTINF:4,
a.m4s
#EXT-X-DISCONTINUITY
#EXT-X-MAP:URI="init2.mp4"
#EXTINF:4,
b.m4s
#EXT-X-ENDLIST
`;

const DASH = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT8S">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v1" bandwidth="800000" width="640" height="360" codecs="avc1.4d401e">
        <SegmentTemplate timescale="1000" duration="4000" startNumber="1" initialization="v1/init.mp4" media="v1/seg-$Number$.m4s"/>
      </Representation>
      <Representation id="v2" bandwidth="2000000" width="1280" height="720" codecs="avc1.4d401f">
        <SegmentTemplate timescale="1000" duration="4000" startNumber="1" initialization="v2/init.mp4" media="v2/seg-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio">
      <Representation id="a1" bandwidth="64000" codecs="mp4a.40.2">
        <SegmentTemplate timescale="1000" duration="4000" startNumber="1" initialization="a1/init.mp4" media="a1/seg-$Number$.m4s"/>
      </Representation>
      <Representation id="a2" bandwidth="128000" codecs="mp4a.40.2">
        <SegmentTemplate timescale="1000" duration="4000" startNumber="1" initialization="a2/init.mp4" media="a2/seg-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const DASH_VIDEO_ONLY = DASH.replace(/<AdaptationSet mimeType="audio\/mp4"[\s\S]*?<\/AdaptationSet>/, '');
const DASH_LIVE =DASH.replace('type="static"', 'type="dynamic"');
const DASH_PROTECTED = DASH.replace('<Representation id="v1"', '<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/><Representation id="v1"');

const FILES: Record<string, string> = {
  [`${CDN}/master.m3u8`]: HLS_MASTER,
  [`${CDN}/v360.m3u8`]: TS_PLAYLIST,
  [`${CDN}/v720.m3u8`]: FMP4_PLAYLIST,
  [`${CDN}/audio/a.m3u8`]: AAC_PLAYLIST,
  [`${CDN}/audio-only.m3u8`]: AAC_PLAYLIST,
  [`${CDN}/single.m3u8`]: TS_PLAYLIST,
  [`${CDN}/encrypted.m3u8`]: ENCRYPTED_PLAYLIST,
  [`${CDN}/live.m3u8`]: LIVE_PLAYLIST,
  [`${CDN}/changing.m3u8`]: CHANGING_INIT_PLAYLIST,
  [`${CDN}/manifest.mpd`]: DASH,
  [`${CDN}/video-only.mpd`]: DASH_VIDEO_ONLY,
  [`${CDN}/live.mpd`]: DASH_LIVE,
  [`${CDN}/protected.mpd`]: DASH_PROTECTED,
};

const fetchText: FetchText = (url) => {
  const text = FILES[url];
  return Promise.resolve(text === undefined ? fail('The stream\'s playlist could not be loaded.') : ok({ text, url }));
};

function itemOf(kind: 'hls' | 'dash', file: string): MediaItem {
  const url = `${CDN}/${file}`;
  return { id: url, url, title: 'Show', site: 'cdn.example.com', kind, container: 'mp4', qualities: [], protected: false };
}

function optionOf(variantId: string, quality: QualityOption['quality'] = '720p', extra: Partial<StreamVariant> = {}): QualityOption {
  return { quality, label: quality, variant: { variantId, ...extra } };
}

describe('planStream for HLS', () => {
  test('a TS rendition: its segments in order, the sequence number kept, and a separate sound rendition joined', async () => {
    const plan = await planStream(itemOf('hls', 'master.m3u8'), optionOf(`${CDN}/v360.m3u8`, '360p'), fetchText);

    expect(plan).toEqual({
      ok: true,
      value: {
        encrypted: false,
        soundOnly: false,
        requests: [
          { url: `${CDN}/seg0.ts` },
          { url: `${CDN}/seg1.ts` },
          { url: `${CDN}/audio/a0.aac` },
          { url: `${CDN}/audio/a1.aac` },
        ],
        sources: [
          {
            format: 'ts',
            segments: [
              { name: segmentName(0), sequence: 7 },
              { name: segmentName(1), sequence: 8 },
            ],
          },
          {
            format: 'adts',
            segments: [
              { name: segmentName(2), sequence: 0 },
              { name: segmentName(3), sequence: 1 },
            ],
          },
        ],
      },
    });
  });

  test('an fMP4 rendition: the init section is fetched first, byte ranges kept', async () => {
    const plan = await planStream(itemOf('hls', 'master.m3u8'), optionOf(`${CDN}/v720.m3u8`), fetchText);

    expect(plan.ok && plan.value.requests).toEqual([
      { url: `${CDN}/init.mp4` },
      { url: `${CDN}/media.mp4`, byteRange: { offset: 0, length: 1000 } },
      { url: `${CDN}/media.mp4`, byteRange: { offset: 1000, length: 1200 } },
    ]);
    expect(plan.ok && plan.value.sources).toMatchObject([{ format: 'fmp4', init: { name: segmentName(0) } }]);
  });

  test('a media playlist on its own is its only rendition', async () => {
    const plan = await planStream(itemOf('hls', 'single.m3u8'), optionOf(`${CDN}/single.m3u8`, 'best'), fetchText);

    expect(plan.ok && plan.value.requests).toHaveLength(2);
  });

  test('an encrypted playlist keeps each segment key and asks for a decryptor', async () => {
    const plan = await planStream(itemOf('hls', 'encrypted.m3u8'), optionOf(`${CDN}/encrypted.m3u8`, 'best'), fetchText);

    expect(plan.ok && plan.value.encrypted).toBe(true);
    expect(plan.ok && plan.value.sources[0]?.segments[1]).toEqual({ name: segmentName(1), key: { url: `${CDN}/key.bin` }, sequence: 4 });
  });

  test('a rendition that is only sound stands alone', async () => {
    const plan = await planStream(itemOf('hls', 'master.m3u8'), optionOf(`${CDN}/audio-only.m3u8`, 'audio', { audioOnly: true }), fetchText);

    expect(plan.ok && plan.value.sources).toHaveLength(1);
    expect(plan.ok && plan.value.soundOnly).toBe(true);
  });

  test('the sound of a rendition with a sound rendition of its own is taken from that rendition alone', async () => {
    const plan = await planStream(itemOf('hls', 'master.m3u8'), optionOf(`${CDN}/v360.m3u8`, 'audio', { audioOnly: false }), fetchText);

    expect(plan.ok && plan.value.requests.map((request) => request.url)).toEqual([`${CDN}/audio/a0.aac`, `${CDN}/audio/a1.aac`]);
    expect(plan.ok && plan.value.sources.map((source) => source.format)).toEqual(['adts']);
    expect(plan.ok && plan.value.soundOnly).toBe(true);
  });

  test('the sound inside the segments of a picture is left to the muxer: the picture is planned and marked sound only', async () => {
    const plan = await planStream(itemOf('hls', 'master.m3u8'), optionOf(`${CDN}/v720.m3u8`, 'audio', { audioOnly: false }), fetchText);

    expect(plan.ok && plan.value.requests.map((request) => request.url)).toEqual([`${CDN}/init.mp4`, `${CDN}/media.mp4`, `${CDN}/media.mp4`]);
    expect(plan.ok && plan.value.soundOnly).toBe(true);
  });
});

describe('planStream for DASH', () => {
  test('joins the picture with the richest sound', async () => {
    const plan = await planStream(itemOf('dash', 'manifest.mpd'), optionOf('v2'), fetchText);

    expect(plan.ok && plan.value.requests.map((request) => request.url)).toEqual([
      `${CDN}/v2/init.mp4`,
      `${CDN}/v2/seg-1.m4s`,
      `${CDN}/v2/seg-2.m4s`,
      `${CDN}/a2/init.mp4`,
      `${CDN}/a2/seg-1.m4s`,
      `${CDN}/a2/seg-2.m4s`,
    ]);
    expect(plan.ok && plan.value.sources.map((source) => source.format)).toEqual(['fmp4', 'fmp4']);
    expect(plan.ok && plan.value.encrypted).toBe(false);
  });

  test('a sound representation stands alone', async () => {
    const plan = await planStream(itemOf('dash', 'manifest.mpd'), optionOf('a1', 'audio', { audioOnly: true }), fetchText);

    expect(plan.ok && plan.value.requests.map((request) => request.url)).toEqual([`${CDN}/a1/init.mp4`, `${CDN}/a1/seg-1.m4s`, `${CDN}/a1/seg-2.m4s`]);
  });

  test('the sound of a picture comes from the richest sound representation alone', async () => {
    const plan = await planStream(itemOf('dash', 'manifest.mpd'), optionOf('v1', 'audio', { audioOnly: false }), fetchText);

    expect(plan.ok && plan.value.requests.map((request) => request.url)).toEqual([`${CDN}/a2/init.mp4`, `${CDN}/a2/seg-1.m4s`, `${CDN}/a2/seg-2.m4s`]);
    expect(plan.ok && plan.value.soundOnly).toBe(true);
  });

  test('without a sound representation the picture is planned and the muxer keeps its sound', async () => {
    const plan = await planStream(itemOf('dash', 'video-only.mpd'), optionOf('v1', 'audio', { audioOnly: false }), fetchText);

    expect(plan.ok && plan.value.requests.map((request) => request.url)).toEqual([`${CDN}/v1/init.mp4`, `${CDN}/v1/seg-1.m4s`, `${CDN}/v1/seg-2.m4s`]);
    expect(plan.ok && plan.value.soundOnly).toBe(true);
  });
});

describe('planStream refusals', () => {
  test.each<[string, MediaItem, QualityOption, string]>([
    ['a quality without a rendition', itemOf('hls', 'master.m3u8'), { quality: '720p', label: '720p' }, 'not available'],
    ['a rendition the playlist no longer lists', itemOf('hls', 'master.m3u8'), optionOf(`${CDN}/v999.m3u8`), 'not available'],
    ['a representation the manifest no longer lists', itemOf('dash', 'manifest.mpd'), optionOf('v9'), 'not available'],
    ['a live playlist', itemOf('hls', 'live.m3u8'), optionOf(`${CDN}/live.m3u8`, 'best'), 'Live'],
    ['a live manifest', itemOf('dash', 'live.mpd'), optionOf('v1'), 'Live'],
    ['a protected manifest', itemOf('dash', 'protected.mpd'), optionOf('v1'), 'DRM'],
    ['a protected item', { ...itemOf('hls', 'master.m3u8'), protected: true }, optionOf(`${CDN}/v360.m3u8`), 'DRM'],
    ['a video that changes its init section', itemOf('hls', 'changing.m3u8'), optionOf(`${CDN}/changing.m3u8`, 'best'), 'changes its format'],
    ['a playlist that cannot be loaded', itemOf('hls', 'missing.m3u8'), optionOf(`${CDN}/missing.m3u8`, 'best'), 'could not be loaded'],
    ['a direct file', { ...itemOf('hls', 'master.m3u8'), kind: 'direct' }, optionOf('x'), 'not a stream'],
  ])('refuses %s with a message', async (_name, item, option, messagePart) => {
    const plan = await planStream(item, option, fetchText);

    expect(!plan.ok && plan.error).toContain(messagePart);
  });
});

describe('assemblePlan', () => {
  test('names the parts by their position in the list to fetch, init sections first', () => {
    const plan = assemblePlan([
      { format: 'fmp4', init: { url: 'https://x/i1' }, segments: [{ request: { url: 'https://x/a' } }] },
      { format: 'fmp4', init: { url: 'https://x/i2' }, segments: [{ request: { url: 'https://x/b' } }] },
    ]);

    expect(plan.requests.map((request) => request.url)).toEqual(['https://x/i1', 'https://x/a', 'https://x/i2', 'https://x/b']);
    expect(plan.sources.map((source) => [source.init?.name, source.segments[0]?.name])).toEqual([
      [segmentName(0), segmentName(1)],
      [segmentName(2), segmentName(3)],
    ]);
  });
});
