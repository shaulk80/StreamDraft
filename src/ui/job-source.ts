import { isJobState, jobIdFromKey, JobStateStore, type JobAreaLike, type JobState } from '../engine/job-state.ts';
import type { JobSource } from './job-tracker.ts';

/** The part of `browser.storage` the source uses. */
export interface StorageLike {
  local: JobAreaLike;
  onChanged: {
    addListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void;
  };
}

/** The job states the background saved in `storage.local`, and their changes. */
export class StorageJobSource implements JobSource {
  private readonly store: JobStateStore;

  constructor(private readonly storage: StorageLike) {
    this.store = new JobStateStore(storage.local);
  }

  loadAll(): Promise<JobState[]> {
    return this.store.loadAll();
  }

  onChange(listener: (state: JobState) => void): void {
    this.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return;
      }

      for (const [key, change] of Object.entries(changes)) {
        if (jobIdFromKey(key) !== undefined && isJobState(change.newValue)) {
          listener(change.newValue);
        }
      }
    });
  }
}
