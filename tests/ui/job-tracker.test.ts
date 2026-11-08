import { describe, expect, test, vi } from 'vitest';
import { fail, ok } from '../../src/core/result.ts';
import { STALE_AFTER_MS, type JobState } from '../../src/engine/job-state.ts';
import { JobTracker, type JobSource } from '../../src/ui/job-tracker.ts';

const NOW = 1_000_000;

function job(changes: Partial<JobState>): JobState {
  return {
    id: 'job-1',
    itemId: 'https://example.com/a.m3u8',
    title: 'A video',
    status: 'running',
    doneSegments: 1,
    totalSegments: 10,
    bytes: 100,
    updatedAt: NOW,
    ...changes,
  };
}

class FakeSource implements JobSource {
  private listener: ((state: JobState) => void) | undefined;

  constructor(private readonly saved: JobState[] = []) {}

  loadAll(): Promise<JobState[]> {
    return Promise.resolve(this.saved);
  }

  onChange(listener: (state: JobState) => void): void {
    this.listener = listener;
  }

  save(state: JobState): void {
    this.listener?.(state);
  }
}

async function startedTracker(saved: JobState[] = []): Promise<{ tracker: JobTracker; source: FakeSource }> {
  const source = new FakeSource(saved);
  const tracker = new JobTracker(source, () => Promise.resolve(ok(undefined)), () => NOW);
  await tracker.start();
  return { tracker, source };
}

describe('JobTracker.runningFor', () => {
  test.each<[string, JobState[], string | undefined]>([
    ['a running job of the video', [job({})], 'job-1'],
    ['a job of another video', [job({ itemId: 'https://example.com/other.m3u8' })], undefined],
    ['a finished job', [job({ status: 'done' })], undefined],
    ['a running job nobody saved for a long time', [job({ updatedAt: NOW - STALE_AFTER_MS - 1 })], undefined],
    ['two running jobs: the one saved last', [job({ id: 'old', updatedAt: NOW - 5 }), job({ id: 'new', updatedAt: NOW })], 'new'],
  ])('finds %s', async (_name, saved, expectedId) => {
    const { tracker } = await startedTracker(saved);

    expect(tracker.runningFor('https://example.com/a.m3u8')?.id).toBe(expectedId);
  });
});

describe('JobTracker.watch', () => {
  test('tells the last known state at once, and every change after it', async () => {
    const { tracker, source } = await startedTracker([job({ doneSegments: 2 })]);
    const seen: number[] = [];

    tracker.watch('job-1', (state) => seen.push(state.doneSegments));
    source.save(job({ doneSegments: 5, updatedAt: NOW + 1 }));

    expect(seen).toEqual([2, 5]);
  });

  test('tells nothing about another job', async () => {
    const { tracker, source } = await startedTracker();
    const listener = vi.fn();

    tracker.watch('job-1', listener);
    source.save(job({ id: 'job-2' }));

    expect(listener).not.toHaveBeenCalled();
  });

  test('ignores a state older than the one it knows', async () => {
    const { tracker, source } = await startedTracker([job({ doneSegments: 5, updatedAt: NOW })]);
    const listener = vi.fn();
    tracker.watch('job-1', listener);
    listener.mockClear();

    source.save(job({ doneSegments: 3, updatedAt: NOW - 10 }));

    expect(listener).not.toHaveBeenCalled();
  });

  test('stops telling once the job has ended', async () => {
    const { tracker, source } = await startedTracker();
    const listener = vi.fn();
    tracker.watch('job-1', listener);

    source.save(job({ status: 'done', updatedAt: NOW + 1 }));
    source.save(job({ status: 'done', updatedAt: NOW + 2 }));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('tells an already ended job once and keeps no listener', async () => {
    const { tracker, source } = await startedTracker([job({ status: 'failed', error: 'No.' })]);
    const listener = vi.fn();

    tracker.watch('job-1', listener);
    source.save(job({ status: 'failed', error: 'No.', updatedAt: NOW + 1 }));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('does not lose a change saved while the first states are loading', async () => {
    const source = new FakeSource([job({ doneSegments: 1, updatedAt: NOW })]);
    const tracker = new JobTracker(source, () => Promise.resolve(ok(undefined)), () => NOW);

    const starting = tracker.start();
    source.save(job({ doneSegments: 9, updatedAt: NOW + 5 }));
    await starting;

    expect(tracker.runningFor('https://example.com/a.m3u8')?.doneSegments).toBe(9);
  });
});

describe('JobTracker.cancel', () => {
  test('passes the request on and gives its answer', async () => {
    const requestCancel = vi.fn(() => Promise.resolve(fail<void>('The extension did not answer. Try again.')));
    const tracker = new JobTracker(new FakeSource(), requestCancel, () => NOW);

    const result = await tracker.cancel('job-1');

    expect(requestCancel).toHaveBeenCalledWith('job-1');
    expect(result).toEqual({ ok: false, error: 'The extension did not answer. Try again.' });
  });
});
