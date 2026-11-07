import { describe, expect, test } from 'vitest';
import { detectType, extensionOf, normalizeContentType } from '../../src/detect/media-types.ts';

describe('normalizeContentType', () => {
  test.each<[string, string | undefined, string]>([
    ['plain', 'video/mp4', 'video/mp4'],
    ['parameters dropped', 'video/mp4; codecs="avc1.42E01E"', 'video/mp4'],
    ['case and spaces', '  Video/WebM ', 'video/webm'],
    ['missing', undefined, ''],
  ])('%s', (_name, raw, expected) => {
    expect(normalizeContentType(raw)).toBe(expected);
  });
});

describe('extensionOf', () => {
  test.each<[string, string, string]>([
    ['simple', '/media/clip.mp4', 'mp4'],
    ['upper case', '/media/CLIP.MP4', 'mp4'],
    ['last dot wins', '/a.b/clip.final.webm', 'webm'],
    ['no extension', '/media/clip', ''],
    ['dot in a folder only', '/a.b/clip', ''],
    ['empty', '', ''],
  ])('%s', (_name, pathname, expected) => {
    expect(extensionOf(pathname)).toBe(expected);
  });
});

describe('detectType', () => {
  test.each<[string, string | undefined, string, string | undefined]>([
    ['mp4 by content type', 'video/mp4', '/x', 'direct:mp4'],
    ['content type wins over extension', 'video/webm', '/x.mp4', 'direct:webm'],
    ['audio by content type', 'audio/mpeg', '/x', 'direct:mp3'],
    ['mp4 by extension when type is generic', 'application/octet-stream', '/x.mp4', 'direct:mp4'],
    ['mp4 by extension when type is missing', undefined, '/x.MP4', 'direct:mp4'],
    ['extension ignored when the type says it is a page', 'text/html', '/x.mp4', undefined],
    ['image', 'image/png', '/x.png', undefined],
    ['unknown video type', 'video/x-unknown', '/x', undefined],
    ['transport stream segment', 'video/mp2t', '/seg1.ts', undefined],
    ['dash segment served as mp4', 'video/mp4', '/seg1.m4s', undefined],
    ['hls by content type', 'application/vnd.apple.mpegurl', '/x', 'hls'],
    ['hls by extension', 'text/plain', '/master.m3u8', 'hls'],
    ['dash by content type', 'application/dash+xml', '/x', 'dash'],
    ['dash by extension', undefined, '/manifest.mpd', 'dash'],
  ])('%s', (_name, contentType, pathname, expected) => {
    const detected = detectType(contentType, pathname);
    const summary = detected?.kind === 'direct' ? `direct:${detected.file.container}` : detected?.kind;
    expect(summary).toBe(expected);
  });

  test('audio files are marked audio only', () => {
    const detected = detectType('audio/mp4', '/x');

    expect(detected?.kind === 'direct' && detected.file.audioOnly).toBe(true);
  });
});
