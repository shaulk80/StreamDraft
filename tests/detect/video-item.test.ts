import { describe, expect, test } from 'vitest';
import type { MediaElementInfo } from '../../src/detect/dom-candidates.ts';
import { classifyCandidate } from '../../src/detect/classify.ts';
import { itemOfElement } from '../../src/detect/video-item.ts';

const PAGE = { url: 'https://example.com/watch', title: 'Watch' };

function element(overrides: Partial<MediaElementInfo>): MediaElementInfo {
  return { currentSrc: '', src: '', sources: [], ...overrides };
}

describe('itemOfElement', () => {
  test('a video with a file gets the item the page scanner reports for it', () => {
    const item = itemOfElement(element({ currentSrc: 'https://cdn.example.com/a.mp4' }), PAGE);
    const reported = classifyCandidate({
      url: 'https://cdn.example.com/a.mp4',
      pageUrl: PAGE.url,
      pageTitle: PAGE.title,
    });

    expect(item).toBeDefined();
    expect(reported.ok && reported.value.id).toBe(item?.id);
  });

  test('the fragment of the address is not part of the id', () => {
    const item = itemOfElement(element({ currentSrc: 'https://cdn.example.com/a.mp4#t=5' }), PAGE);

    expect(item?.id).toBe('https://cdn.example.com/a.mp4');
  });

  test.each<[string, MediaElementInfo]>([
    ['no file chosen yet', element({})],
    ['a blob stream', element({ currentSrc: 'blob:https://example.com/1234' })],
    ['a file type that is not media', element({ currentSrc: 'https://example.com/a.html' })],
    ['a stream manifest', element({ currentSrc: 'https://example.com/master.m3u8' })],
  ])('%s gives nothing', (_name, info) => {
    expect(itemOfElement(info, PAGE)).toBeUndefined();
  });
});
