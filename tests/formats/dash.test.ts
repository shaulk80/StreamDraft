import { describe, expect, test } from 'vitest';
import { parseDashManifest } from '../../src/formats/dash.ts';
import type { DashManifest, DashRepresentation } from '../../src/formats/dash-types.ts';
import {
  LIST_MANIFEST,
  MANIFEST_URL,
  ON_DEMAND_MANIFEST,
  PLAIN_FILE_MANIFEST,
  TEMPLATE_MANIFEST,
  TIMELINE_MANIFEST,
  protectedManifest,
  templateManifest,
} from './dash-fixtures.ts';

const BASE = 'https://cdn.example.com/dash/';

/** Test helper: an error makes the test fail with the parser's own message. */
function parse(text: string): DashManifest {
  const result = parseDashManifest(text, MANIFEST_URL);
  if (!result.ok) {
    expect.fail(`expected the manifest to parse: ${result.error}`);
  }
  return result.value;
}

function onlyVideo(text: string): DashRepresentation {
  const video = parse(text).video[0];
  if (video === undefined) {
    expect.fail('expected a video representation');
  }
  return video;
}

describe('SegmentTemplate with a fixed length', () => {
  test('lists video and audio representations with their properties', () => {
    const manifest = parse(TEMPLATE_MANIFEST);

    expect(manifest.video.map((video) => video.variantId)).toEqual(['bbb_30fps_1024x576_2500k', 'bbb_30fps_1920x1080_8000k']);
    expect(manifest.video[1]).toMatchObject({ width: 1920, height: 1080, frameRate: 30, bandwidth: 9914554, codecs: 'avc1.640028', mimeType: 'video/mp4' });
    expect(manifest.audio.map((audio) => audio.variantId)).toEqual(['bbb_a64k']);
    expect(manifest.audio[0]).toMatchObject({ audioOnly: true, codecs: 'mp4a.40.5', bandwidth: 67071 });
    expect(manifest).toMatchObject({ live: false, durationSeconds: 634.566, url: MANIFEST_URL });
  });

  test('builds addresses from the relative BaseURL, the init pattern and the segment numbers', () => {
    const video = parse(TEMPLATE_MANIFEST).video[0];

    expect(video?.init?.url).toBe(`${BASE}bbb_30fps_1024x576_2500k/bbb_30fps_1024x576_2500k_0.m4v`);
    expect(video?.segments[0]?.url).toBe(`${BASE}bbb_30fps_1024x576_2500k/bbb_30fps_1024x576_2500k_1.m4v`);
    expect(video?.segments[1]?.url).toBe(`${BASE}bbb_30fps_1024x576_2500k/bbb_30fps_1024x576_2500k_2.m4v`);
  });

  test.each([
    ['video', 159, 2.566],
    ['audio', 159, 0.881],
  ])('counts the %s segments from the length of the video: %s, the last one %s s', (kind, count, lastSeconds) => {
    const manifest = parse(TEMPLATE_MANIFEST);
    const representation = kind === 'video' ? manifest.video[0] : manifest.audio[0];
    const segments = representation?.segments ?? [];

    expect(segments).toHaveLength(count);
    expect(segments.at(-1)?.durationSeconds).toBeCloseTo(lastSeconds, 2);
    expect(segments[0]?.durationSeconds).toBeCloseTo(kind === 'video' ? 4 : 4.0107, 3);
  });

  test.each([
    ['padded numbers from 0', '<SegmentTemplate duration="10" media="s$Number%05d$.m4s" startNumber="0"/>', ['s00000.m4s', 's00001.m4s', 's00002.m4s'], [10, 10, 5]],
    ['an end number', '<SegmentTemplate duration="10" media="s$Number$.m4s" endNumber="2"/>', ['s1.m4s', 's2.m4s'], [10, 10]],
    ['a time scale', '<SegmentTemplate duration="5000" timescale="1000" media="t$Time$.m4s"/>', ['t0.m4s', 't5000.m4s', 't10000.m4s', 't15000.m4s', 't20000.m4s'], [5, 5, 5, 5, 5]],
  ])('%s', (_name, template, files, durations) => {
    const video = onlyVideo(templateManifest(template));

    expect(video.segments.map((segment) => segment.url.replace(BASE, ''))).toEqual(files);
    expect(video.segments.map((segment) => segment.durationSeconds)).toEqual(durations);
  });
});

describe('SegmentTimeline', () => {
  test('expands repeats and uses the start time in the address', () => {
    const video = onlyVideo(TIMELINE_MANIFEST);

    expect(video.init?.url).toBe(`${BASE}init-v1.mp4`);
    expect(video.segments.map((segment) => segment.url)).toEqual([
      `${BASE}seg-v1-0.m4s`,
      `${BASE}seg-v1-6000.m4s`,
      `${BASE}seg-v1-12000.m4s`,
      `${BASE}seg-v1-18000.m4s`,
    ]);
    expect(video.segments.map((segment) => segment.durationSeconds)).toEqual([6, 6, 6, 2]);
    expect(video.frameRate).toBeCloseTo(29.97, 2);
  });

  test('a repeat count of -1 runs to the end of the period', () => {
    const template = '<SegmentTemplate timescale="1000" media="s$Time$.m4s"><SegmentTimeline><S t="0" d="5000" r="-1"/></SegmentTimeline></SegmentTemplate>';

    expect(onlyVideo(templateManifest(template)).segments).toHaveLength(5);
  });

  test('a dynamic manifest is marked live', () => {
    const live = parse(TIMELINE_MANIFEST.replace('type="static"', 'type="dynamic"'));

    expect(live.live).toBe(true);
  });
});

describe('SegmentList', () => {
  test('lists the segments with their ranges and the initialisation range', () => {
    const [audio] = parse(LIST_MANIFEST).audio;

    expect(audio?.language).toBe('de');
    expect(audio?.init).toEqual({ url: `${BASE}init.mp4`, byteRange: { offset: 0, length: 100 } });
    expect(audio?.segments).toEqual([
      { url: `${BASE}s1.m4s`, byteRange: undefined, durationSeconds: 4 },
      { url: `${BASE}s2.m4s`, byteRange: { offset: 100, length: 100 }, durationSeconds: 4 },
    ]);
  });
});

describe('SegmentBase and plain files', () => {
  test('one-file representations: init range, then the media from the end of the index to the end of the file', () => {
    const manifest = parse(ON_DEMAND_MANIFEST);
    const base = 'http://dash.edgesuite.net/dash264/TestCases/1a/netflix/';

    expect(manifest.audio[0]).toMatchObject({
      variantId: '1',
      language: 'en',
      codecs: 'mp4a.40.5',
      init: { url: `${base}ElephantsDream_AAC48K_064.mp4.dash`, byteRange: { offset: 0, length: 871 } },
      segments: [{ url: `${base}ElephantsDream_AAC48K_064.mp4.dash`, byteRange: { offset: 11132 } }],
    });
    expect(manifest.video[0]).toMatchObject({
      variantId: '5',
      height: 360,
      frameRate: 24,
      init: { byteRange: { offset: 0, length: 985 } },
      segments: [{ byteRange: { offset: 11246 } }],
    });
    expect(manifest.durationSeconds).toBe(654);
  });

  test('a representation with only a BaseURL is one plain file without an init segment', () => {
    const video = onlyVideo(PLAIN_FILE_MANIFEST);

    expect(video.init).toBeUndefined();
    expect(video.segments).toEqual([{ url: `${BASE}movie.mp4` }]);
  });
});

describe('protected streams', () => {
  const widevine = '<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>';
  const cenc = '<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>';

  test.each([
    ['Widevine next to the common marker', `${cenc}${widevine}`, 'Widevine DRM'],
    ['PlayReady', '<ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/>', 'PlayReady DRM'],
    ['only the common encryption marker', cenc, 'Common encryption (CENC)'],
    ['an unknown scheme', '<ContentProtection schemeIdUri="urn:example:secret"/>', 'DRM protection'],
  ])('%s is reported and lists nothing to download', (_name, protection, reason) => {
    const manifest = parse(protectedManifest(protection));

    expect(manifest.protectedReason).toBe(reason);
    expect(manifest.video).toEqual([]);
    expect(manifest.audio).toEqual([]);
  });

  test('an unprotected manifest has no reason', () => {
    expect(parse(TEMPLATE_MANIFEST).protectedReason).toBeUndefined();
  });
});

describe('errors', () => {
  test.each([
    ['text that is not XML', 'hello', 'Not a DASH manifest: The XML has no root element.'],
    ['a broken document', '<MPD><Period></MPD>', 'Not a DASH manifest: The closing tag </MPD> does not match <Period>.'],
    ['another XML document', '<html/>', 'Not a DASH manifest.'],
    ['no period', '<MPD/>', 'The manifest has no period.'],
    ['two periods', '<MPD><Period/><Period/></MPD>', 'Streams with several periods (for example with ads) are not supported yet.'],
    ['only subtitles', '<MPD><Period><AdaptationSet contentType="text"><Representation id="t"/></AdaptationSet></Period></MPD>', 'The manifest lists no video or audio.'],
    ['a representation without an id', '<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation bandwidth="1"/></AdaptationSet></Period></MPD>', 'A representation has no id.'],
    ['a fixed segment length without a video length', templateManifest('<SegmentTemplate duration="4" media="s$Number$.m4s"/>', ''), 'Representation r1: The manifest does not say how long the video is, so its segments cannot be counted.'],
    ['a template without an address pattern', templateManifest('<SegmentTemplate duration="4"/>'), 'Representation r1: The segment template has no address pattern.'],
    ['a template with neither timeline nor length', templateManifest('<SegmentTemplate media="s$Number$.m4s"/>'), 'Representation r1: The segment template has neither a timeline nor a segment length.'],
    ['an unknown template identifier', templateManifest('<SegmentTemplate duration="4" media="s$Foo$.m4s"/>'), 'Representation r1: Bad segment address pattern: s$Foo$.m4s'],
    ['a timeline entry without a length', templateManifest('<SegmentTemplate media="s$Time$"><SegmentTimeline><S t="0"/></SegmentTimeline></SegmentTemplate>'), 'Representation r1: A segment in the timeline has no valid length.'],
    ['an open timeline without a period length', templateManifest('<SegmentTemplate media="s$Time$"><SegmentTimeline><S d="5" r="-1"/></SegmentTimeline></SegmentTemplate>', ''), 'Representation r1: The timeline repeats to the end of the period, but the period has no length.'],
    ['too many segments', templateManifest('<SegmentTemplate duration="1" media="s$Number$.m4s"/>', 'mediaPresentationDuration="PT999999999S"'), 'Representation r1: The manifest lists too many segments.'],
  ])('%s gives an error', (_name, text, message) => {
    expect(parseDashManifest(text, MANIFEST_URL)).toEqual({ ok: false, error: message });
  });

  test('an invalid manifest address gives an error', () => {
    expect(parseDashManifest(TEMPLATE_MANIFEST, 'not an address').ok).toBe(false);
  });
});
