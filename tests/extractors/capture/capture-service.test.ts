import { describe, expect, test, vi } from 'vitest';
import { fail, ok } from '../../../src/core/result.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/core/settings.ts';
import type { StreamRequest } from '../../../src/engine/job-coordinator.ts';
import type { RecordingInput } from '../../../src/engine/recording-input.ts';
import { CaptureService, type CapturePages, type TabDetails } from '../../../src/extractors/capture/capture-service.ts';
import type { CaptureSnapshot } from '../../../src/extractors/capture/types.ts';

const ON: Settings = { ...DEFAULT_SETTINGS, playerCapture: true };
const RECORDING: RecordingInput = {
  buffers: [{ kind: 'video', init: { name: 'b1-init', url: 'blob:page/1' }, fragments: [{ name: 'b1-000001', url: 'blob:page/2', startSeconds: 0 }] }],
};
const SNAPSHOT: CaptureSnapshot = { protected: false, durationSeconds: 4, buffers: [], missing: [], problems: [], complete: true };
const TAB: TabDetails = { url: 'https://www.example.com/watch?v=1', title: 'A video' };

function setup(options: { settings?: Settings; pages?: Partial<CapturePages>; tab?: TabDetails | undefined } = {}) {
  const requests: StreamRequest[] = [];
  const pages: CapturePages = {
    arm: vi.fn(() => Promise.resolve(ok(undefined))),
    reload: vi.fn(() => Promise.resolve(ok(undefined))),
    status: vi.fn(() => Promise.resolve(ok(SNAPSHOT))),
    save: vi.fn(() => Promise.resolve(ok(RECORDING))),
    discard: vi.fn(() => Promise.resolve(ok(undefined))),
    ...options.pages,
  };
  const service = new CaptureService({
    pages,
    streams: {
      start: (request) => {
        requests.push(request);
        return Promise.resolve(ok({ jobId: 'job1' }));
      },
    },
    tab: () => Promise.resolve('tab' in options ? options.tab : TAB),
    loadSettings: () => Promise.resolve(options.settings ?? ON),
    today: () => '2026-11-13',
  });
  return { service, pages, requests };
}

describe('CaptureService.arm', () => {
  test('marks the tab and reloads it, in that order', async () => {
    const { service, pages } = setup();

    expect(await service.arm(3)).toEqual({ ok: true, value: undefined });

    expect(vi.mocked(pages.arm).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(pages.reload).mock.invocationCallOrder[0] ?? 0);
  });

  test('does nothing while the player capture is switched off', async () => {
    const { service, pages } = setup({ settings: DEFAULT_SETTINGS });

    const armed = await service.arm(3);

    expect(!armed.ok && armed.error).toContain('switched off');
    expect(pages.arm).not.toHaveBeenCalled();
    expect(pages.reload).not.toHaveBeenCalled();
  });

  test('does not reload a page that could not be marked', async () => {
    const { service, pages } = setup({ pages: { arm: () => Promise.resolve(fail('The page would not let StreamDraft prepare it.')) } });

    const armed = await service.arm(3);

    expect(armed).toEqual({ ok: false, error: 'The page would not let StreamDraft prepare it.' });
    expect(pages.reload).not.toHaveBeenCalled();
  });
});

describe('CaptureService.save', () => {
  test.each<[string, boolean, string, string]>([
    ['the picture and the sound', false, 'A video [original].mp4', 'best'],
    ['the sound only', true, 'A video [audio].m4a', 'audio'],
  ])('starts a job that joins %s, named by the template', async (_name, soundOnly, filename, quality) => {
    const { service, requests } = setup();

    const saved = await service.save(3, soundOnly);

    expect(saved).toEqual({ ok: true, value: { filename, jobId: 'job1' } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      filename,
      recording: RECORDING,
      option: { quality },
      item: { id: 'capture:3', kind: 'capture', title: 'A video', site: 'example.com', url: TAB.url, protected: false },
    });
  });

  test.each<[string, TabDetails | undefined, string]>([
    ['no tab details', undefined, 'unknown [original].mp4'],
    ['an empty title', { url: 'https://www.example.com/', title: '  ' }, 'example.com [original].mp4'],
    ['an address that is not one', { url: 'not an address', title: 'Clip' }, 'Clip [original].mp4'],
  ])('names the file when there are %s', async (_name, tab, filename) => {
    const { service } = setup({ tab });

    const saved = await service.save(3, false);

    expect(saved.ok && saved.value.filename).toBe(filename);
  });

  test('a recording that is not ready starts no job', async () => {
    const { service, requests } = setup({ pages: { save: () => Promise.resolve(fail('The recording is not complete.')) } });

    expect(await service.save(3, false)).toEqual({ ok: false, error: 'The recording is not complete.' });
    expect(requests).toEqual([]);
  });

  test('a job the engine refuses is reported', async () => {
    const service = new CaptureService({
      pages: { arm: vi.fn(), reload: vi.fn(), status: vi.fn(), save: () => Promise.resolve(ok(RECORDING)), discard: vi.fn() },
      streams: { start: () => Promise.resolve(fail('A download with this name is already running.')) },
      tab: () => Promise.resolve(TAB),
      loadSettings: () => Promise.resolve(ON),
      today: () => '2026-11-13',
    });

    expect(await service.save(3, false)).toEqual({ ok: false, error: 'A download with this name is already running.' });
  });
});

describe('CaptureService status and discard', () => {
  test('pass the page\'s answer on', async () => {
    const { service, pages } = setup();

    expect(await service.status(3)).toEqual({ ok: true, value: SNAPSHOT });
    expect(await service.discard(3)).toEqual({ ok: true, value: undefined });
    expect(pages.status).toHaveBeenCalledWith(3);
    expect(pages.discard).toHaveBeenCalledWith(3);
  });
});
