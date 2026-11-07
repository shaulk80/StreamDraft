import { describe, expect, test, vi } from 'vitest';
import { refreshVideos } from '../../src/ui/refresh.ts';

describe('refreshVideos', () => {
  test.each<[string, number, string]>([
    ['no videos', 0, 'Checked the page again. No videos found.'],
    ['one video', 1, 'Checked the page again. 1 video listed.'],
    ['several videos', 4, 'Checked the page again. 4 videos listed.'],
  ])('a page that answers: %s', async (_name, count, expected) => {
    const rescanPage = vi.fn(() => Promise.resolve({ ok: true, value: count }));
    const reloadList = vi.fn(() => Promise.resolve(count));

    expect(await refreshVideos({ rescanPage, reloadList })).toBe(expected);
  });

  test('the page is asked before the list is read, so the list holds what the page reported', async () => {
    const order: string[] = [];
    const rescanPage = vi.fn(() => {
      order.push('rescan');
      return Promise.resolve({ ok: true, value: 2 });
    });
    const reloadList = vi.fn(() => {
      order.push('reload');
      return Promise.resolve(2);
    });

    await refreshVideos({ rescanPage, reloadList });

    expect(order).toEqual(['rescan', 'reload']);
  });

  test.each<[string, () => Promise<unknown>]>([
    ['the page cannot be reached', () => Promise.reject(new Error('Could not establish connection'))],
    ['the page answers with a failure', () => Promise.resolve({ ok: false, error: 'x' })],
    ['the page gives no answer', () => Promise.resolve(undefined)],
  ])('%s: the saved list is still shown, with a hint', async (_name, rescanPage) => {
    const reloadList = vi.fn(() => Promise.resolve(3));

    const text = await refreshVideos({ rescanPage, reloadList });

    expect(reloadList).toHaveBeenCalledTimes(1);
    expect(text).toContain('Could not check the page again');
    expect(text).toContain('3 videos listed.');
  });
});
