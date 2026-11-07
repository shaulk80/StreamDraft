import { describe, expect, test, vi } from 'vitest';
import type { MediaItem } from '../../src/core/media.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings.ts';
import { DownloadService, type DownloadsLike } from '../../src/engine/download-service.ts';

const DIRECT: MediaItem = {
  id: 'https://cdn.example.com/v/clip.mp4',
  url: 'https://cdn.example.com/v/clip.mp4',
  title: 'Holiday: day 1',
  site: 'example.com',
  kind: 'direct',
  container: 'mp4',
  qualities: [{ quality: 'best', label: 'MP4', sizeBytes: 5_000_000 }],
  protected: false,
};

function createService(items: MediaItem[], settings: Settings = DEFAULT_SETTINGS, failWith?: Error) {
  const download = vi.fn<DownloadsLike['download']>(() => {
    if (failWith) {
      return Promise.reject(failWith);
    }
    return Promise.resolve(42);
  });
  const service = new DownloadService({
    downloads: { download },
    listItems: () => Promise.resolve(items),
    loadSettings: () => Promise.resolve(settings),
    today: () => '2026-11-07',
  });
  return { service, download };
}

describe('DownloadService.start', () => {
  test('downloads the listed file under the template name, never overwriting, leaving "ask where to save" to the user', async () => {
    const { service, download } = createService([DIRECT]);

    const result = await service.start(7, { itemId: DIRECT.id, quality: 'best' });

    expect(result).toEqual({ ok: true, value: { filename: 'Holiday_ day 1 [original].mp4', downloadId: 42 } });
    expect(download).toHaveBeenCalledWith({
      url: DIRECT.url,
      filename: 'Holiday_ day 1 [original].mp4',
      conflictAction: 'uniquify',
    });
  });

  test('the filename template of the settings is used', async () => {
    const { service } = createService([DIRECT], { ...DEFAULT_SETTINGS, filenameTemplate: '{site} {date}' });

    const result = await service.start(7, { itemId: DIRECT.id, quality: 'best' });

    expect(result.ok && result.value.filename).toBe('example.com 2026-11-07.mp4');
  });

  test('a quality the file does not have falls back to its only option', async () => {
    const { service } = createService([DIRECT]);

    const result = await service.start(7, { itemId: DIRECT.id, quality: '1080p' });

    expect(result.ok).toBe(true);
  });

  test.each<[string, MediaItem[], string, string]>([
    ['an item that is not listed', [DIRECT], 'https://evil.example/x.mp4', 'no longer listed'],
    ['nothing listed', [], DIRECT.id, 'no longer listed'],
    ['a protected item', [{ ...DIRECT, protected: true }], DIRECT.id, 'DRM'],
    ['a stream', [{ ...DIRECT, kind: 'hls' }], DIRECT.id, 'Streamed'],
    ['an item without qualities', [{ ...DIRECT, qualities: [] }], DIRECT.id, 'no quality'],
  ])('refuses %s without asking the browser', async (_name, items, itemId, messagePart) => {
    const { service, download } = createService(items);

    const result = await service.start(7, { itemId, quality: 'best' });

    expect(!result.ok && result.error).toContain(messagePart);
    expect(download).not.toHaveBeenCalled();
  });

  test('a refusal of the browser is reported, not thrown', async () => {
    const { service } = createService([DIRECT], DEFAULT_SETTINGS, new Error('Invalid filename'));

    const result = await service.start(7, { itemId: DIRECT.id, quality: 'best' });

    expect(result).toEqual({ ok: false, error: 'The browser could not start the download.' });
  });
});

describe('DownloadService.startForAddress', () => {
  const OTHER: MediaItem = { ...DIRECT, id: 'https://cdn.example.com/v/other.mp4', url: 'https://cdn.example.com/v/other.mp4' };

  test.each<[string, MediaItem[], string | undefined, string]>([
    ['the item with that address', [DIRECT, OTHER], OTHER.url, OTHER.url],
    ['the same address with a fragment', [DIRECT, OTHER], `${OTHER.url}#t=5`, OTHER.url],
    ['the only item when the address is unknown (a blob source)', [DIRECT], 'blob:https://example.com/1234', DIRECT.url],
    ['the only item when there is no address', [DIRECT], undefined, DIRECT.url],
  ])('downloads %s', async (_name, items, address, expectedUrl) => {
    const { service, download } = createService(items);

    const result = await service.startForAddress(7, address);

    expect(result.ok).toBe(true);
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ url: expectedUrl }));
  });

  test.each<[string, MediaItem[], string]>([
    ['nothing was found', [], 'No video was found'],
    ['several videos and an unknown address', [DIRECT, OTHER], 'Could not tell which video'],
  ])('refuses when %s', async (_name, items, messagePart) => {
    const { service, download } = createService(items);

    const result = await service.startForAddress(7, 'blob:https://example.com/1234');

    expect(!result.ok && result.error).toContain(messagePart);
    expect(download).not.toHaveBeenCalled();
  });

  test('uses the default quality of the settings', async () => {
    const twoQualities: MediaItem = {
      ...DIRECT,
      qualities: [
        { quality: '1080p', label: '1080p' },
        { quality: '480p', label: '480p' },
      ],
    };
    const { service } = createService([twoQualities], { ...DEFAULT_SETTINGS, defaultQuality: '480p', filenameTemplate: '{quality}' });

    const result = await service.startForAddress(7, DIRECT.url);

    expect(result.ok && result.value.filename).toBe('480p.mp4');
  });
});
