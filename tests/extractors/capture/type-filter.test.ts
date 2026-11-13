import { describe, expect, test } from 'vitest';
import { isHiddenMediaType, isRecordableMediaType, mediaKindOf } from '../../../src/extractors/capture/type-filter.ts';

describe('isHiddenMediaType', () => {
  test.each([
    ['VP9 in WebM', 'video/webm; codecs="vp9"'],
    ['VP9 with the long codec name', 'video/webm; codecs="vp09.02.51.10.01.09.16.09.00"'],
    ['VP8', 'video/webm; codecs="vp8"'],
    ['AV1 in MP4', 'video/mp4; codecs=av01.0.05M.08'],
    ['AV1 by its short name', 'video/mp4; codecs="av1"'],
    ['Opus in WebM', 'audio/webm; codecs="opus"'],
    ['capital letters', 'VIDEO/WEBM; CODECS="VP9"'],
    ['VP9 with more parameters', 'video/webm; codecs="vp9"; width=3840; height=2160; bitrate=20000000'],
  ])('hides %s', (_name, type) => {
    expect(isHiddenMediaType(type)).toBe(true);
  });

  test.each([
    ['H.264', 'video/mp4; codecs="avc1.4d401e"'],
    ['H.264 with parameters', 'video/mp4; codecs="avc1.4d401e"; width=640; framerate=30'],
    ['AAC', 'audio/mp4; codecs="mp4a.40.2"'],
    ['HEVC', 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
    ['not a string', 42],
    ['nothing', undefined],
  ])('lets %s through', (_name, type) => {
    expect(isHiddenMediaType(type)).toBe(false);
  });
});

describe('isRecordableMediaType', () => {
  test.each([
    ['video/mp4; codecs="avc1.4d401e"', true],
    ['audio/mp4; codecs="mp4a.40.2"', true],
    [' video/mp4', true],
    ['audio/webm; codecs="opus"', false],
    ['video/mp2t', false],
    ['text/vtt', false],
  ])('%s: %s', (type, expected) => {
    expect(isRecordableMediaType(type)).toBe(expected);
  });
});

describe('mediaKindOf', () => {
  test.each([
    ['video/mp4; codecs="avc1.4d401e"', 'video'],
    ['audio/mp4', 'audio'],
    ['application/octet-stream', 'unknown'],
  ])('%s is %s', (type, expected) => {
    expect(mediaKindOf(type)).toBe(expected);
  });
});
