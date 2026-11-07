import { describe, expect, test, vi } from 'vitest';
import type { MediaItem } from '../../src/core/media.ts';
import { fail, ok } from '../../src/core/result.ts';
import { addPageCandidates } from '../../src/detect/page-reports.ts';

function createRegistry(failing = false) {
  const added: MediaItem[] = [];
  const add = vi.fn((_tabId: number, item: MediaItem) => {
    if (failing) {
      return Promise.resolve(fail<MediaItem[]>('storage is full'));
    }
    added.push(item);
    return Promise.resolve(ok([...added]));
  });
  return { registry: { add }, add, added };
}

describe('addPageCandidates', () => {
  test('videos are added to the tab, anything else is dropped', async () => {
    const { registry, add, added } = createRegistry();

    const accepted = await addPageCandidates(registry, 5, [
      { url: 'https://example.com/a.mp4', pageUrl: 'https://example.com/', pageTitle: 'Page' },
      { url: 'blob:https://example.com/1234' },
      { url: 'https://example.com/readme.html', contentType: 'text/html' },
      { url: 'https://example.com/b.webm' },
    ]);

    expect(accepted).toBe(2);
    expect(add).toHaveBeenCalledWith(5, expect.anything());
    expect(added.map((item) => item.title)).toEqual(['Page', 'b']);
  });

  test('items the registry could not keep are not counted', async () => {
    const { registry } = createRegistry(true);

    expect(await addPageCandidates(registry, 5, [{ url: 'https://example.com/a.mp4' }])).toBe(0);
  });
});
