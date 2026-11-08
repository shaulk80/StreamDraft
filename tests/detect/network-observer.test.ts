import { describe, expect, test, vi } from 'vitest';
import type { MediaItem } from '../../src/core/media.ts';
import { ok } from '../../src/core/result.ts';
import {
  NetworkObserver,
  type ObserverDeps,
  type ResponseDetails,
  type TabInfo,
} from '../../src/detect/network-observer.ts';

/** `null` stands for a tab that is gone. */
function createObserver(tab: TabInfo | null = { url: 'https://example.com/watch', title: 'Watch me' }) {
  const items: MediaItem[] = [];
  const registry = {
    add: vi.fn((_tabId: number, item: MediaItem) => {
      items.push(item);
      return Promise.resolve(ok([...items]));
    }),
    list: vi.fn(() => Promise.resolve([...items])),
    clear: vi.fn(() => Promise.resolve(ok(undefined))),
  };
  const lookupTab = vi.fn(() => Promise.resolve(tab ?? undefined));
  const deps: ObserverDeps = { registry, lookupTab };
  return { observer: new NetworkObserver(deps), registry, lookupTab, items };
}

function response(overrides: Partial<ResponseDetails> = {}): ResponseDetails {
  return {
    url: 'https://cdn.example.com/clip.mp4',
    tabId: 7,
    statusCode: 200,
    type: 'media',
    responseHeaders: [
      { name: 'Content-Type', value: 'video/mp4' },
      { name: 'Content-Length', value: String(5 * 1024 * 1024) },
    ],
    ...overrides,
  };
}

describe('NetworkObserver.handleResponse', () => {
  test('a video response is added to its tab with the page title and site', async () => {
    const { observer, registry } = createObserver();

    await observer.handleResponse(response());

    expect(registry.add).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ url: 'https://cdn.example.com/clip.mp4', title: 'Watch me', site: 'example.com' }),
    );
  });

  test('the size of a partial response is the total of the file', async () => {
    const { observer, items } = createObserver();

    await observer.handleResponse(
      response({
        statusCode: 206,
        responseHeaders: [
          { name: 'content-type', value: 'video/mp4' },
          { name: 'content-range', value: `bytes 0-99/${3 * 1024 * 1024}` },
          { name: 'content-length', value: '100' },
        ],
      }),
    );

    expect(items[0]?.qualities[0]?.sizeBytes).toBe(3 * 1024 * 1024);
  });

  test.each<[string, Partial<ResponseDetails>]>([
    ['not from a tab (the extension itself)', { tabId: -1 }],
    ['a redirect', { statusCode: 302 }],
    ['a not-found page', { statusCode: 404 }],
    ['an image', { url: 'https://example.com/a.png', responseHeaders: [{ name: 'content-type', value: 'image/png' }] }],
    ['an ad clip that is tiny', { responseHeaders: [{ name: 'content-type', value: 'video/mp4' }, { name: 'content-length', value: '900' }] }],
    ['an HLS segment', { url: 'https://example.com/seg1.ts', responseHeaders: [{ name: 'content-type', value: 'video/mp2t' }] }],
  ])('ignores %s', async (_name, overrides) => {
    const { observer, registry } = createObserver();

    await observer.handleResponse(response(overrides));

    expect(registry.add).not.toHaveBeenCalled();
  });

  test.each([
    ['an HLS playlist', 'https://cdn.example.com/a.m3u8', 'application/vnd.apple.mpegurl', 'hls'],
    ['a DASH manifest', 'https://cdn.example.com/a.mpd', 'application/dash+xml', 'dash'],
    ['a playlist sent as plain text', 'https://cdn.example.com/a.m3u8', 'text/plain', 'hls'],
  ])('lists %s as a stream', async (_name, url, contentType, kind) => {
    const { observer, items } = createObserver();

    await observer.handleResponse(response({ url, responseHeaders: [{ name: 'content-type', value: contentType }] }));

    expect(items).toMatchObject([{ kind, url, title: 'Watch me', qualities: [] }]);
  });

  test('a file seen again does not look the tab up again', async () => {
    const { observer, lookupTab, registry } = createObserver();

    await observer.handleResponse(response());
    await observer.handleResponse(response());

    expect(lookupTab).toHaveBeenCalledTimes(1);
    expect(registry.add).toHaveBeenCalledTimes(2);
  });

  test.each<[string, TabInfo | null, Partial<ResponseDetails>, string]>([
    ['tab gone: the page address of the request is used', null, { documentUrl: 'https://page.example.org/x' }, 'page.example.org'],
    ['tab gone, Chrome: the initiator origin is used', null, { initiator: 'https://origin.example.net' }, 'origin.example.net'],
    ['tab gone, nothing else: the file host is used', null, {}, 'cdn.example.com'],
  ])('%s', async (_name, tab, overrides, expectedSite) => {
    const { observer, items } = createObserver(tab);

    await observer.handleResponse(response(overrides));

    expect(items[0]?.site).toBe(expectedSite);
    expect(items[0]?.title).toBe('clip');
  });
});

describe('NetworkObserver.handleRequestStart', () => {
  test('a new page in a tab forgets the old videos', async () => {
    const { observer, registry } = createObserver();

    await observer.handleRequestStart({ tabId: 7, type: 'main_frame' });

    expect(registry.clear).toHaveBeenCalledWith(7);
  });

  test.each<[string, number, string]>([
    ['a sub-resource of the page', 7, 'media'],
    ['a frame inside the page', 7, 'sub_frame'],
    ['a request not from a tab', -1, 'main_frame'],
  ])('%s keeps them', async (_name, tabId, type) => {
    const { observer, registry } = createObserver();

    await observer.handleRequestStart({ tabId, type });

    expect(registry.clear).not.toHaveBeenCalled();
  });
});
