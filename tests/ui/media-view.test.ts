import { describe, expect, test } from 'vitest';
import type { MediaItem } from '../../src/core/media.ts';
import { MOCK_MEDIA } from '../../src/core/mock-media.ts';
import { metaText } from '../../src/ui/media-view.ts';

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
