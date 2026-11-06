import { describe, expect, test } from 'vitest';
import { downloadFilename, formatSize, pickQuality, type MediaItem } from '../../src/core/media.ts';
import { MOCK_MEDIA } from '../../src/core/mock-media.ts';
import type { Quality } from '../../src/core/settings.ts';

function mockItem(id: string): MediaItem {
  const item = MOCK_MEDIA.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`No mock item ${id}`);
  }
  return item;
}

describe('pickQuality', () => {
  test.each<[string, string, Quality, Quality | undefined]>([
    ['exact match', 'mock-hls', '720p', '720p'],
    ['best gives the first option', 'mock-hls', 'best', '1080p'],
    ['missing quality gives the next lower one', 'mock-dash', '720p', '360p'],
    ['audio when the video has it', 'mock-hls', 'audio', 'audio'],
    ['audio missing gives the first option', 'mock-dash', 'audio', '1080p'],
    ['wanted below everything gives the first option', 'mock-dash', '360p', '360p'],
    ['no options gives nothing', 'mock-protected', '720p', undefined],
  ])('%s', (_name, id, wanted, expected) => {
    expect(pickQuality(mockItem(id), wanted)?.quality).toBe(expected);
  });

  test('a video-only ladder never falls back to audio', () => {
    const item: MediaItem = {
      ...mockItem('mock-hls'),
      qualities: [
        { quality: '1080p', label: '1080p' },
        { quality: 'audio', label: 'Audio only' },
      ],
    };

    expect(pickQuality(item, '480p')?.quality).toBe('1080p');
  });
});

describe('formatSize', () => {
  test.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [48 * 1024 * 1024, '48 MB'],
    [1400 * 1024 * 1024, '1.4 GB'],
    [5 * 1024 ** 4, '5120 GB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });
});

describe('downloadFilename', () => {
  const template = '{title} [{quality}]';

  test.each([
    ['a video option uses the container', 'mock-hls', '720p', 'Conference talk_ opening keynote [720p].mp4'],
    ['the audio option uses m4a', 'mock-hls', 'audio', 'Conference talk_ opening keynote [audio].m4a'],
  ])('%s', (_name, id, quality, expected) => {
    const item = mockItem(id);
    const option = item.qualities.find((candidate) => candidate.quality === quality);

    expect(option).toBeDefined();
    expect(option && downloadFilename(item, option, template, '2026-11-06')).toBe(expected);
  });
});
