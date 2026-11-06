import { describe, expect, test } from 'vitest';
import { pickQuality, type MediaItem } from '../../src/core/media.ts';
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
