import { afterEach, describe, expect, test, vi } from 'vitest';
import type { MediaItem, QualityOption } from '../../src/core/media.ts';
import { fail, ok } from '../../src/core/result.ts';
import { CANCELLED_MESSAGE } from '../../src/engine/cancelled.ts';
import type { EngineHost, FinishedFile } from '../../src/engine/engine-types.ts';
import { DownloadHandoffs, JobCoordinator, type HandoffDownloads } from '../../src/engine/job-coordinator.ts';
import { JobStateStore, type JobAreaLike } from '../../src/engine/job-state.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

class MemoryArea implements JobAreaLike {
  readonly data = new Map<string, unknown>();

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(this.data.has(key) ? { [key]: this.data.get(key) } : {});
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.entries(items).forEach(([key, value]) => this.data.set(key, value));
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

const ITEM: MediaItem = {
  id: 'https://cdn.example.com/master.m3u8',
  url: 'https://cdn.example.com/master.m3u8',
  title: 'Show',
  site: 'cdn.example.com',
  kind: 'hls',
  container: 'mp4',
  qualities: [],
  protected: false,
};
const OPTION: QualityOption = { quality: '720p', label: '720p', variant: { variantId: 'https://cdn.example.com/v720.m3u8' } };
const REQUEST = { item: ITEM, option: OPTION, filename: 'Show [720p].mp4' };
const FILE: FinishedFile = { jobId: 'job1', filename: 'Show [720p].mp4', url: 'blob:abc', bytes: 1000 };

/** The coordinator with fakes for the host and the browser; `restart` builds a second one on the same storage, like a woken background. */
function setup(downloadId = 5, found: { state?: string; error?: string }[] = [{ state: 'in_progress' }]) {
  const stateArea = new MemoryArea();
  const handoffArea = new MemoryArea();
  const states = new JobStateStore(stateArea);
  const host = {
    start: vi.fn<EngineHost['start']>(() => Promise.resolve(ok(undefined))),
    cancel: vi.fn<EngineHost['cancel']>(() => Promise.resolve()),
    release: vi.fn<EngineHost['release']>(() => Promise.resolve()),
  };
  const downloads = {
    download: vi.fn<HandoffDownloads['download']>(() => Promise.resolve(downloadId)),
    search: vi.fn<HandoffDownloads['search']>(() => Promise.resolve(found)),
  };
  let time = 0;
  const build = (): JobCoordinator =>
    new JobCoordinator({
      host,
      downloads,
      states,
      handoffs: new DownloadHandoffs(handoffArea),
      newJobId: () => 'job1',
      // Every look at the clock is a second later, so progress is never held back as too frequent.
      now: () => (time += 1000),
    });
  return { coordinator: build(), restart: build, states, host, downloads };
}

describe('JobCoordinator.start', () => {
  test('saves the job as running and gives it to the engine host', async () => {
    const { coordinator, states, host } = setup();

    const result = await coordinator.start(REQUEST);

    expect(result).toEqual({ ok: true, value: { jobId: 'job1' } });
    expect(await states.load('job1')).toMatchObject({ id: 'job1', itemId: ITEM.id, title: 'Show', status: 'running' });
    expect(host.start).toHaveBeenCalledWith({ jobId: 'job1', filename: 'Show [720p].mp4', item: ITEM, option: OPTION });
  });

  test('a host that cannot start the job fails it and says why', async () => {
    const { coordinator, states, host } = setup();
    host.start.mockResolvedValue(fail('The part of the extension that downloads streams is not available.'));

    const result = await coordinator.start(REQUEST);

    expect(result.ok).toBe(false);
    expect(await states.load('job1')).toMatchObject({ status: 'failed', error: 'The part of the extension that downloads streams is not available.' });
  });
});

describe('JobCoordinator.handleEvent', () => {
  test('progress is saved for the popup', async () => {
    const { coordinator, states } = setup();
    await coordinator.start(REQUEST);

    await coordinator.handleEvent({ kind: 'progress', jobId: 'job1', progress: { doneSegments: 3, totalSegments: 10, bytes: 300 } });

    await vi.waitFor(async () => {
      expect(await states.load('job1')).toMatchObject({ status: 'running', doneSegments: 3, totalSegments: 10, bytes: 300 });
    });
  });

  test('a finished file is handed to the browser; the job stays running until the browser has saved it', async () => {
    const { coordinator, states, downloads, host } = setup();
    await coordinator.start(REQUEST);
    await coordinator.handleEvent({ kind: 'progress', jobId: 'job1', progress: { doneSegments: 10, totalSegments: 10, bytes: 300 } });

    await coordinator.handleEvent({ kind: 'finished', jobId: 'job1', result: ok(FILE) });

    expect(downloads.download).toHaveBeenCalledWith({ url: 'blob:abc', filename: 'Show [720p].mp4', conflictAction: 'uniquify' });
    expect((await states.load('job1'))?.status).toBe('running');
    expect(host.release).not.toHaveBeenCalled();
  });

  test('when the browser has saved the file the job is done and the engine cleans up, once', async () => {
    const { coordinator, states, host } = setup();
    await coordinator.start(REQUEST);
    await coordinator.handleEvent({ kind: 'progress', jobId: 'job1', progress: { doneSegments: 9, totalSegments: 10, bytes: 300 } });
    await coordinator.handleEvent({ kind: 'finished', jobId: 'job1', result: ok(FILE) });

    await coordinator.handleDownloadChange({ id: 5, state: { current: 'complete' } });
    await coordinator.handleDownloadChange({ id: 5, state: { current: 'complete' } });

    expect(await states.load('job1')).toMatchObject({ status: 'done', doneSegments: 10, totalSegments: 10 });
    expect(host.release).toHaveBeenCalledExactlyOnceWith('job1');
  });

  test('a file the browser saved before the hand-off returned is not left waiting', async () => {
    const { coordinator, states, host } = setup(5, [{ state: 'complete' }]);
    await coordinator.start(REQUEST);

    await coordinator.handleEvent({ kind: 'finished', jobId: 'job1', result: ok(FILE) });

    expect((await states.load('job1'))?.status).toBe('done');
    expect(host.release).toHaveBeenCalledExactlyOnceWith('job1');
  });

  test.each<[string, string | undefined, string, string | undefined]>([
    ['the disk or the connection failed', 'FILE_FAILED', 'failed', 'The browser could not save the finished video.'],
    ['no reason is given', undefined, 'failed', 'The browser could not save the finished video.'],
    ['the user cancelled the save', 'USER_CANCELED', 'cancelled', undefined],
  ])('a save that was interrupted (%s) ends the job and cleans up', async (_name, reason, status, message) => {
    const { coordinator, states, host } = setup();
    await coordinator.start(REQUEST);
    await coordinator.handleEvent({ kind: 'finished', jobId: 'job1', result: ok(FILE) });

    await coordinator.handleDownloadChange({ id: 5, state: { current: 'interrupted' }, error: { current: reason } });

    expect(await states.load('job1')).toMatchObject({ status, error: message });
    expect(host.release).toHaveBeenCalledExactlyOnceWith('job1');
  });

  test('a browser that refuses the download fails the job and cleans up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { coordinator, states, downloads, host } = setup();
    downloads.download.mockRejectedValue(new Error('Invalid filename'));
    await coordinator.start(REQUEST);

    await coordinator.handleEvent({ kind: 'finished', jobId: 'job1', result: ok(FILE) });

    expect(await states.load('job1')).toMatchObject({ status: 'failed', error: 'The browser could not start saving the finished video.' });
    expect(host.release).toHaveBeenCalledExactlyOnceWith('job1');
  });

  test.each<[string, string, string]>([
    ['an engine failure', 'Segment 4 of 10: The server answered 404.', 'failed'],
    ['a cancelled job', CANCELLED_MESSAGE, 'cancelled'],
  ])('%s ends the job; the engine has cleaned up by itself', async (_name, error, status) => {
    const { coordinator, states, host, downloads } = setup();
    await coordinator.start(REQUEST);

    await coordinator.handleEvent({ kind: 'finished', jobId: 'job1', result: fail(error) });

    expect(await states.load('job1')).toMatchObject({ status, error });
    expect(downloads.download).not.toHaveBeenCalled();
    expect(host.release).not.toHaveBeenCalled();
  });

  test('news of a job that already ended is ignored', async () => {
    const { coordinator, states } = setup();
    await coordinator.start(REQUEST);
    await coordinator.handleEvent({ kind: 'finished', jobId: 'job1', result: fail('Segment 1 of 2: The server answered 404.') });

    await coordinator.handleEvent({ kind: 'progress', jobId: 'job1', progress: { doneSegments: 2, totalSegments: 2, bytes: 5 } });

    expect(await states.load('job1')).toMatchObject({ status: 'failed', doneSegments: 0 });
  });

  test('a background that was stopped and woken goes on from the saved state', async () => {
    const { coordinator, restart, states, host } = setup();
    await coordinator.start(REQUEST);
    await coordinator.handleEvent({ kind: 'progress', jobId: 'job1', progress: { doneSegments: 4, totalSegments: 10, bytes: 100 } });
    const woken = restart();

    await woken.handleEvent({ kind: 'finished', jobId: 'job1', result: ok(FILE) });
    await woken.handleDownloadChange({ id: 5, state: { current: 'complete' } });

    expect(await states.load('job1')).toMatchObject({ status: 'done', title: 'Show', totalSegments: 10 });
    expect(host.release).toHaveBeenCalledExactlyOnceWith('job1');
  });
});

describe('JobCoordinator.handleDownloadChange', () => {
  test.each<[string, number, string]>([
    ['a download that is still going', 5, 'in_progress'],
    ['a download of something else', 99, 'complete'],
  ])('ignores %s', async (_name, id, state) => {
    const { coordinator, states, host } = setup();
    await coordinator.start(REQUEST);
    await coordinator.handleEvent({ kind: 'finished', jobId: 'job1', result: ok(FILE) });

    await coordinator.handleDownloadChange({ id, state: { current: state } });

    expect((await states.load('job1'))?.status).toBe('running');
    expect(host.release).not.toHaveBeenCalled();
  });

  test('a change without a state is ignored', async () => {
    const { coordinator, host } = setup();

    await coordinator.handleDownloadChange({ id: 5 });

    expect(host.release).not.toHaveBeenCalled();
  });
});

describe('JobCoordinator.cancel', () => {
  test('asks the host to stop the job', async () => {
    const { coordinator, host } = setup();

    await coordinator.cancel('job1');

    expect(host.cancel).toHaveBeenCalledWith('job1');
  });
});
