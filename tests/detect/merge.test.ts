import { describe, expect, test } from 'vitest';
import type { MediaItem } from '../../src/core/media.ts';
import { mergeItem } from '../../src/detect/merge.ts';

function item(id: string, sizeBytes?: number, title = id): MediaItem {
  return {
    id,
    url: id,
    title,
    site: 'example.com',
    kind: 'direct',
    container: 'mp4',
    qualities: [{ quality: 'best', label: 'MP4', sizeBytes }],
    protected: false,
  };
}

describe('mergeItem', () => {
  test('a new address is appended and the input list is not changed', () => {
    const original = [item('a')];

    const merged = mergeItem(original, item('b'));

    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(original).toHaveLength(1);
  });

  test.each<[string, number | undefined, number | undefined, number | undefined]>([
    ['size is learned when the first sighting had none', undefined, 500, 500],
    ['a known size is kept', 400, 500, 400],
    ['no size on either side', undefined, undefined, undefined],
  ])('same address again: %s', (_name, firstSize, secondSize, expected) => {
    const merged = mergeItem([item('a', firstSize)], item('a', secondSize));

    expect(merged).toHaveLength(1);
    expect(merged[0]?.qualities[0]?.sizeBytes).toBe(expected);
  });

  test('the first title is kept', () => {
    const merged = mergeItem([item('a', undefined, 'first')], item('a', 500, 'second'));

    expect(merged[0]?.title).toBe('first');
  });
});
