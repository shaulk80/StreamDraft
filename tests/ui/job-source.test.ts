import { describe, expect, test, vi } from 'vitest';
import { jobKey, type JobAreaLike, type JobState } from '../../src/engine/job-state.ts';
import { StorageJobSource, type StorageLike } from '../../src/ui/job-source.ts';

const STATE: JobState = {
  id: 'job-1',
  itemId: 'https://example.com/a.m3u8',
  title: 'A video',
  status: 'running',
  doneSegments: 1,
  totalSegments: 10,
  bytes: 100,
  updatedAt: 5,
};

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;

function fakeStorage(data: Record<string, unknown> = {}): { storage: StorageLike; change: ChangeListener } {
  let registered: ChangeListener | undefined;
  const local: JobAreaLike = {
    get: () => Promise.resolve(data),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
  const storage: StorageLike = {
    local,
    onChanged: {
      addListener: (listener) => {
        registered = listener;
      },
    },
  };
  return { storage, change: (changes, areaName) => registered?.(changes, areaName) };
}

describe('StorageJobSource', () => {
  test('loads the saved jobs', async () => {
    const { storage } = fakeStorage({ [jobKey('job-1')]: STATE });

    expect(await new StorageJobSource(storage).loadAll()).toEqual([STATE]);
  });

  test.each<[string, string, string, unknown, boolean]>([
    ['a job saved in the local area', 'local', jobKey('job-1'), STATE, true],
    ['a job in another area', 'session', jobKey('job-1'), STATE, false],
    ['a key that is not a job', 'local', 'settings', STATE, false],
    ['a removed job', 'local', jobKey('job-1'), undefined, false],
    ['a damaged job', 'local', jobKey('job-1'), { id: 'job-1' }, false],
  ])('reports %s', (_name, areaName, key, newValue, reported) => {
    const { storage, change } = fakeStorage();
    const listener = vi.fn();
    new StorageJobSource(storage).onChange(listener);

    change({ [key]: { newValue } }, areaName);

    expect(listener).toHaveBeenCalledTimes(reported ? 1 : 0);
  });
});
