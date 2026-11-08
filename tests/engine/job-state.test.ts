import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  JobProgressReporter,
  JobStateStore,
  jobIdFromKey,
  jobKey,
  isStale,
  STALE_AFTER_MS,
  type JobAreaLike,
  type JobState,
} from '../../src/engine/job-state.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

class MemoryArea implements JobAreaLike {
  data: Record<string, unknown> = {};
  failing = false;

  get(key: string | null): Promise<Record<string, unknown>> {
    if (this.failing) {
      return Promise.reject(new Error('storage unavailable'));
    }
    if (key === null) {
      return Promise.resolve(structuredClone(this.data));
    }
    return Promise.resolve(key in this.data ? { [key]: structuredClone(this.data[key]) } : {});
  }

  set(items: Record<string, unknown>): Promise<void> {
    if (this.failing) {
      return Promise.reject(new Error('storage unavailable'));
    }
    Object.assign(this.data, structuredClone(items));
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    Reflect.deleteProperty(this.data, key);
    return Promise.resolve();
  }
}

const IDENTITY = { id: 'job-1', itemId: 'https://example.com/a.m3u8', title: 'A video' };
const PROGRESS = { doneSegments: 3, totalSegments: 10, bytes: 3000 };

describe('job keys', () => {
  test.each([
    ['streamdraft.job.job-1', 'job-1'],
    ['streamdraft.job.', undefined],
    ['streamdraft.tab.5', undefined],
    ['settings', undefined],
  ])('%s belongs to job %j', (key, jobId) => {
    expect(jobIdFromKey(key)).toBe(jobId);
  });

  test('round trips', () => {
    expect(jobIdFromKey(jobKey('abc-123'))).toBe('abc-123');
  });
});

describe('JobStateStore', () => {
  const state: JobState = { ...IDENTITY, ...PROGRESS, status: 'running', updatedAt: 5 };

  test('loads what was saved', async () => {
    const store = new JobStateStore(new MemoryArea());

    await store.save(state);

    expect(await store.load('job-1')).toEqual(state);
  });

  test.each([
    ['nothing saved', undefined],
    ['a string', 'oops'],
    ['an unknown status', { ...state, status: 'paused' }],
    ['a missing count', { ...state, bytes: undefined }],
  ])('loads nothing when the stored value is %s', async (_name, stored) => {
    const area = new MemoryArea();
    if (stored !== undefined) {
      area.data[jobKey('job-1')] = stored;
    }

    expect(await new JobStateStore(area).load('job-1')).toBeUndefined();
  });

  test('reports a storage error instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const area = new MemoryArea();
    area.failing = true;
    const store = new JobStateStore(area);

    expect(await store.save(state)).toEqual({ ok: false, error: 'The progress of the download could not be saved.' });
    expect(await store.load('job-1')).toBeUndefined();
  });

  test('remove forgets the job', async () => {
    const store = new JobStateStore(new MemoryArea());
    await store.save(state);

    await store.remove('job-1');

    expect(await store.load('job-1')).toBeUndefined();
  });
});

describe('JobProgressReporter', () => {
  function reporterAt(time: { now: number }, area = new MemoryArea()) {
    const store = new JobStateStore(area);
    return { store, reporter: new JobProgressReporter(IDENTITY, store, () => time.now, 500) };
  }

  test('start saves a running job with nothing done', async () => {
    const { store, reporter } = reporterAt({ now: 1000 });

    await reporter.start(10);

    expect(await store.load('job-1')).toEqual({
      ...IDENTITY,
      status: 'running',
      doneSegments: 0,
      totalSegments: 10,
      bytes: 0,
      updatedAt: 1000,
    });
  });

  test('saves progress at most once per interval', async () => {
    const time = { now: 1000 };
    const { store, reporter } = reporterAt(time);
    const save = vi.spyOn(store, 'save');

    await reporter.start(10);
    time.now = 1100;
    reporter.progress({ ...PROGRESS, doneSegments: 1 });
    time.now = 1400;
    reporter.progress({ ...PROGRESS, doneSegments: 2 });
    time.now = 1600;
    reporter.progress({ ...PROGRESS, doneSegments: 3 });
    await reporter.finish('done', PROGRESS);

    expect(save.mock.calls.map(([saved]) => `${saved.status}:${saved.doneSegments}`)).toEqual([
      'running:0',
      'running:3',
      'done:3',
    ]);
  });

  test('the final state is always saved, and last', async () => {
    const time = { now: 1000 };
    const { store, reporter } = reporterAt(time);

    await reporter.start(10);
    time.now = 2000;
    reporter.progress(PROGRESS);
    await reporter.finish('failed', PROGRESS, 'Segment 4 of 10: The server answered 404.');

    expect(await store.load('job-1')).toMatchObject({
      status: 'failed',
      error: 'Segment 4 of 10: The server answered 404.',
      doneSegments: 3,
    });
  });

  test('a save that fails does not stop the ones after it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const area = new MemoryArea();
    const { store, reporter } = reporterAt({ now: 1000 }, area);

    area.failing = true;
    await reporter.start(10);
    area.failing = false;
    await reporter.finish('cancelled', PROGRESS);

    expect(await store.load('job-1')).toMatchObject({ status: 'cancelled' });
  });
});

describe('JobStateStore.loadAll', () => {
  const running: JobState = { ...IDENTITY, ...PROGRESS, status: 'running', updatedAt: 5 };
  const done: JobState = { ...running, id: 'job-2', status: 'done' };

  test('gives every saved job and leaves out other keys and damaged entries', async () => {
    const area = new MemoryArea();
    area.data = {
      [jobKey('job-1')]: running,
      [jobKey('job-2')]: done,
      [jobKey('job-3')]: 'damaged',
      settings: { quality: 'best' },
    };

    const all = await new JobStateStore(area).loadAll();

    expect(all.map((state) => state.id).sort()).toEqual(['job-1', 'job-2']);
  });

  test('gives nothing, and logs, when the storage cannot be read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const area = new MemoryArea();
    area.failing = true;

    expect(await new JobStateStore(area).loadAll()).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });
});

describe('isStale', () => {
  const base: JobState = { ...IDENTITY, ...PROGRESS, status: 'running', updatedAt: 1000 };

  test.each<[string, JobState['status'], number, boolean]>([
    ['a running job saved a moment ago', 'running', 1000 + 1000, false],
    ['a running job saved exactly at the limit', 'running', 1000 + STALE_AFTER_MS, false],
    ['a running job not saved for a long time', 'running', 1000 + STALE_AFTER_MS + 1, true],
    ['a finished job, however old', 'done', 1000 + STALE_AFTER_MS * 10, false],
  ])('%s', (_name, status, now, expected) => {
    expect(isStale({ ...base, status }, now)).toBe(expected);
  });
});
