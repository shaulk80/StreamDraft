import { describe, expect, test } from 'vitest';
import { parseDashManifest } from '../../src/formats/dash.ts';
import {
  LARGE_SAMPLES_PER_SEGMENT,
  LARGE_SEGMENTS,
  LARGE_STREAM_BYTES,
  LARGE_VIDEO_SAMPLE_BYTES,
  largeSampleFill,
  largeStreamFile,
} from './large-stream.ts';

const BASE = 'http://127.0.0.1/gen/large/';
const GIB = 1024 * 1024 * 1024;

describe('largeStreamFile', () => {
  test('the stream is more than 1 GiB', () => {
    expect(LARGE_STREAM_BYTES).toBeGreaterThan(GIB);
  });

  test('the manifest lists every segment of a picture and a sound', async () => {
    const file = largeStreamFile('/gen/large/manifest.mpd');
    const parsed = parseDashManifest(String(file?.body), `${BASE}manifest.mpd`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.video.map((video) => video.segments.length)).toEqual([LARGE_SEGMENTS]);
    expect(parsed.value.audio.map((audio) => audio.segments.length)).toEqual([LARGE_SEGMENTS]);
    expect(parsed.value.video[0]?.segments[1]?.url).toBe(`${BASE}v/seg-2.m4s`);
  });

  test('a picture segment is built on request, 16 samples of 1 MiB', () => {
    const file = largeStreamFile('/gen/large/v/seg-2.m4s');
    const body = file?.body as Uint8Array;

    expect(body.length).toBeGreaterThan(LARGE_SAMPLES_PER_SEGMENT * LARGE_VIDEO_SAMPLE_BYTES);
    expect(body.length).toBeLessThan(LARGE_SAMPLES_PER_SEGMENT * LARGE_VIDEO_SAMPLE_BYTES + 4096);
    // The segment ends with the last byte of its last sample: sample 31 of the track (segment 2 starts at sample 16).
    expect(body.at(-1)).toBe(largeSampleFill(2 * LARGE_SAMPLES_PER_SEGMENT - 1));
  });

  test.each([
    ['a segment past the end', `/gen/large/v/seg-${LARGE_SEGMENTS + 1}.m4s`],
    ['segment 0', '/gen/large/v/seg-0.m4s'],
    ['another folder', '/gen/large/x/seg-1.m4s'],
    ['another stream', '/gen/dash/manifest.mpd'],
  ])('has nothing for %s', (_name, pathname) => {
    expect(largeStreamFile(pathname)).toBeUndefined();
  });
});
