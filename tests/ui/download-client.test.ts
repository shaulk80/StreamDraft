import { describe, expect, test, vi } from 'vitest';
import type { MediaItem } from '../../src/core/media.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { MOCK_MEDIA } from '../../src/core/mock-media.ts';
import { backgroundDownloadAction, demoDownloadAction, readReply, type SendMessage } from '../../src/ui/download-client.ts';

const ITEM: MediaItem = {
  id: 'https://example.com/a.mp4',
  url: 'https://example.com/a.mp4',
  title: 'A',
  site: 'example.com',
  kind: 'direct',
  container: 'mp4',
  qualities: [{ quality: 'best', label: 'MP4' }],
  protected: false,
};
const OPTION = { quality: 'best', label: 'MP4' } as const;

describe('readReply', () => {
  test.each<[string, unknown, { ok: boolean; text: string }]>([
    ['a started download', { ok: true, value: { filename: 'A [original].mp4', downloadId: 3 } }, { ok: true, text: 'Saving as "A [original].mp4".' }],
    ['a refusal', { ok: false, error: 'No longer listed.' }, { ok: false, text: 'No longer listed.' }],
    ['nothing', undefined, { ok: false, text: 'The extension gave no answer.' }],
    ['a string', 'ok', { ok: false, text: 'The extension gave no answer.' }],
    ['an answer of an unknown shape', { ok: true }, { ok: false, text: 'The extension gave an answer that was not understood.' }],
  ])('%s', (_name, reply, expected) => {
    const result = readReply(reply);

    expect(result.ok).toBe(expected.ok);
    expect(result.ok ? result.value : result.error).toBe(expected.text);
  });
});

describe('backgroundDownloadAction', () => {
  test('sends the video id and quality with the tab, and shows the answer', async () => {
    const send = vi.fn<SendMessage>(() => Promise.resolve({ ok: true, value: { filename: 'x.mp4' } }));

    const result = await backgroundDownloadAction(send, 9)(ITEM, OPTION);

    expect(send).toHaveBeenCalledWith({ type: 'download-media', itemId: ITEM.id, quality: 'best', tabId: 9 });
    expect(result).toEqual({ ok: true, value: 'Saving as "x.mp4".' });
  });

  test('a background that does not answer is reported, not thrown', async () => {
    const send = vi.fn<SendMessage>(() => Promise.reject(new Error('Could not establish connection')));

    const result = await backgroundDownloadAction(send)(ITEM, OPTION);

    expect(result.ok).toBe(false);
  });
});

describe('demoDownloadAction', () => {
  test('says what would be saved and does not download', async () => {
    const [first] = MOCK_MEDIA;
    const option = first?.qualities[0];

    const result = first && option ? await demoDownloadAction(DEFAULT_SETTINGS)(first, option) : undefined;

    expect(result?.ok && result.value).toContain('Demo only');
  });
});
