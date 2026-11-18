import { describe, expect, test } from 'vitest';
import { parseDashManifest } from '../../src/formats/dash.ts';
import {
  HUGE,
  LARGE,
  LARGE_SAMPLES_PER_SEGMENT,
  LARGE_VIDEO_SAMPLE_BYTES,
  PROFILES,
  largeSampleFill,
  largeStreamFile,
  type StreamProfile,
} from './large-stream.ts';

const GIB = 1024 * 1024 * 1024;
const UINT32_RANGE = 0x1_0000_0000;

const cases: [string, StreamProfile][] = PROFILES.map((profile) => [profile.folder, profile]);

describe('the sizes', () => {
  test('the large stream is more than 1 GiB', () => {
    expect(LARGE.streamBytes).toBeGreaterThan(GIB);
  });

  test('the huge stream is past what a 32-bit offset can address, with room to spare', () => {
    expect(HUGE.streamBytes).toBeGreaterThan(UINT32_RANGE + GIB / 4);
  });
});

describe.each(cases)('largeStreamFile of the %s stream', (_name, profile) => {
  const base = `http://127.0.0.1/gen/${profile.folder}/`;
  const folder = `/gen/${profile.folder}`;

  test('the manifest lists every segment of a picture and a sound', () => {
    const file = largeStreamFile(`${folder}/manifest.mpd`);
    const parsed = parseDashManifest(String(file?.body), `${base}manifest.mpd`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.video.map((video) => video.segments.length)).toEqual([profile.segments]);
    expect(parsed.value.audio.map((audio) => audio.segments.length)).toEqual([profile.segments]);
    expect(parsed.value.video[0]?.segments[1]?.url).toBe(`${base}v/seg-2.m4s`);
  });

  test('a picture segment is built on request, 16 samples of 1 MiB', () => {
    const file = largeStreamFile(`${folder}/v/seg-2.m4s`);
    const body = file?.body as Uint8Array;

    expect(body.length).toBeGreaterThan(LARGE_SAMPLES_PER_SEGMENT * LARGE_VIDEO_SAMPLE_BYTES);
    expect(body.length).toBeLessThan(LARGE_SAMPLES_PER_SEGMENT * LARGE_VIDEO_SAMPLE_BYTES + 4096);
    // The segment ends with the last byte of its last sample: sample 31 of the track (segment 2 starts at sample 16).
    expect(body.at(-1)).toBe(largeSampleFill(2 * LARGE_SAMPLES_PER_SEGMENT - 1));
  });

  test('the last segment exists and the one after it does not', () => {
    expect(largeStreamFile(`${folder}/a/seg-${profile.segments}.m4s`)).toBeDefined();
    expect(largeStreamFile(`${folder}/a/seg-${profile.segments + 1}.m4s`)).toBeUndefined();
  });

  test.each([
    ['segment 0', `${folder}/v/seg-0.m4s`],
    ['another folder', `${folder}/x/seg-1.m4s`],
    ['another stream', '/gen/dash/manifest.mpd'],
    ['an unknown stream', '/gen/unknown/v/seg-1.m4s'],
  ])('has nothing for %s', (_label, pathname) => {
    expect(largeStreamFile(pathname)).toBeUndefined();
  });
});
