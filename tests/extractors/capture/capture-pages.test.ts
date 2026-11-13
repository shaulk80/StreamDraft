import { afterEach, describe, expect, test, vi } from 'vitest';
import { BrowserCapturePages, type PagesApi } from '../../../src/extractors/capture/capture-pages.ts';

function setup(overrides: Partial<PagesApi> = {}) {
  const sent: unknown[] = [];
  const api: PagesApi = {
    setArmMark: () => Promise.resolve(true),
    reload: () => Promise.resolve(),
    send: (_tabId, message) => {
      sent.push(message);
      return Promise.resolve({ ok: true, value: { answer: 42 } });
    },
    ...overrides,
  };
  return { pages: new BrowserCapturePages(api), sent };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BrowserCapturePages', () => {
  test.each<[string, 'status' | 'save']>([
    ['status', 'status'],
    ['save', 'save'],
  ])('%s asks the page and passes its answer on', async (_name, request) => {
    const { pages, sent } = setup();

    const reply = await pages[request](5);

    expect(reply).toEqual({ ok: true, value: { answer: 42 } });
    expect(sent).toEqual([{ type: 'capture-page-request', request }]);
  });

  test('discard passes on only whether it worked', async () => {
    const { pages } = setup();

    expect(await pages.discard(5)).toEqual({ ok: true, value: undefined });
  });

  test.each<[string, PagesApi['send']]>([
    ['nobody listens in the page', () => Promise.reject(new Error('Receiving end does not exist'))],
  ])('says to press Record when %s', async (_name, send) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { pages } = setup({ send });

    for (const reply of [await pages.status(5), await pages.save(5), await pages.discard(5)]) {
      expect(!reply.ok && reply.error).toContain('Press Record');
    }
  });

  test.each<[string, unknown, string]>([
    ['the page answers with a reason', { ok: false, error: 'Nothing was recorded.' }, 'Nothing was recorded.'],
    ['the page answers with something else', 'yes', 'gave no answer'],
    ['the page answers nothing', undefined, 'gave no answer'],
    ['the page answers a failure without a reason', { ok: false }, 'gave no answer'],
  ])('a failed request is an error: %s', async (_name, reply, message) => {
    const { pages } = setup({ send: () => Promise.resolve(reply) });

    const answer = await pages.save(5);

    expect(!answer.ok && answer.error).toContain(message);
  });

  test.each<[string, Partial<PagesApi>, string]>([
    ['the page does not allow the mark', { setArmMark: () => Promise.resolve(false) }, 'would not let StreamDraft'],
    ['marking throws', { setArmMark: () => Promise.reject(new Error('no access')) }, 'would not let StreamDraft'],
  ])('arming fails when %s', async (_name, overrides, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { pages } = setup(overrides);

    const armed = await pages.arm(5);

    expect(!armed.ok && armed.error).toContain(message);
  });

  test('arming succeeds, and a tab that cannot be reloaded is an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { pages } = setup({ reload: () => Promise.reject(new Error('gone')) });

    expect(await pages.arm(5)).toEqual({ ok: true, value: undefined });
    expect(await pages.reload(5)).toEqual({ ok: false, error: 'The page could not be reloaded.' });
  });
});
