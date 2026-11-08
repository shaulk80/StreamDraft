import { describe, expect, test } from 'vitest';
import type { MediaItem } from '../../src/core/media.ts';
import { MOCK_MEDIA } from '../../src/core/mock-media.ts';
import { listSignature, metaText, noticeText } from '../../src/ui/media-view.ts';

const DIRECT: MediaItem = {
  id: 'a',
  url: 'https://cdn.example.com/v/Summer%20trip.mp4',
  title: 'Holiday page',
  site: 'example.com',
  kind: 'direct',
  container: 'mp4',
  qualities: [{ quality: 'best', label: 'MP4' }],
  protected: false,
};

describe('metaText', () => {
  test('a direct file shows its file name', () => {
    expect(metaText(DIRECT)).toBe('example.com · Direct file · Summer trip.mp4');
  });

  test('a direct file whose address has no name shows the container', () => {
    expect(metaText({ ...DIRECT, url: 'https://cdn.example.com/' })).toBe('example.com · Direct file · mp4');
  });

  test.each(MOCK_MEDIA.filter((item) => item.kind !== 'direct').map((item) => [item.kind, item] as const))(
    'a %s stream shows its container, not the manifest name',
    (_kind, item) => {
      expect(metaText(item)).toContain(` · ${item.container}`);
    },
  );
});

const STREAM: MediaItem = { ...DIRECT, kind: 'hls', url: 'https://cdn.example.com/master.m3u8', qualities: [] };

describe('noticeText', () => {
  test.each<[string, MediaItem, string | undefined]>([
    ['a direct file has none', DIRECT, undefined],
    ['a stream not read yet says it is being read', STREAM, 'Reading the stream...'],
    ['a stream that could not be read says why', { ...STREAM, manifestError: 'The server answered 403.' }, 'The server answered 403.'],
    ['a stream with qualities has none', { ...STREAM, qualities: [{ quality: 'best', label: 'Best quality' }] }, undefined],
    ['a protected stream names the protection', { ...STREAM, protected: true, protectedReason: 'Widevine DRM' }, 'Protected (Widevine DRM). StreamDraft does not download protected videos.'],
    ['a protected stream without a name says DRM', { ...STREAM, protected: true }, 'Protected (DRM). StreamDraft does not download protected videos.'],
  ])('%s', (_name, item, expected) => {
    expect(noticeText(item)).toBe(expected);
  });
});

describe('listSignature', () => {
  test.each<[string, MediaItem]>([
    ['qualities arrive', { ...STREAM, qualities: [{ quality: 'best', label: 'Best quality' }] }],
    ['the manifest cannot be read', { ...STREAM, manifestError: 'Nope.' }],
    ['the stream turns out to be protected', { ...STREAM, protected: true }],
  ])('changes when %s', (_name, changed) => {
    expect(listSignature([changed])).not.toBe(listSignature([STREAM]));
  });

  test('does not change for a new title, so a quality choice is not reset', () => {
    expect(listSignature([{ ...STREAM, title: 'Another' }])).toBe(listSignature([STREAM]));
  });
});
