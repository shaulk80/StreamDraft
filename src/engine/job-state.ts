import { fail, ok, type Result } from '../core/result.ts';
import type { JobProgress } from './segment-job.ts';

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

/**
 * What the popup shows of a job. Kept in `storage.local`, not in a variable:
 * the background can be stopped at any time, and the popup (or a restarted
 * background) still finds the last known progress.
 */
export interface JobState {
  id: string;
  itemId: string;
  title: string;
  status: JobStatus;
  doneSegments: number;
  totalSegments: number;
  bytes: number;
  /** In plain words, set when the status is `failed`. */
  error?: string;
  updatedAt: number;
}

/** The part of a `storage` area the store uses. */
export interface JobAreaLike {
  /** `null` reads the whole area. */
  get(key: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const KEY_PREFIX = 'streamdraft.job.';
const STATUSES: readonly JobStatus[] = ['running', 'done', 'failed', 'cancelled'];

/** The storage key of a job, so other parts can watch it with `storage.onChanged`. */
export function jobKey(jobId: string): string {
  return `${KEY_PREFIX}${jobId}`;
}

/** The job a storage key belongs to, or undefined when the key is not a job key. */
export function jobIdFromKey(key: string): string | undefined {
  if (!key.startsWith(KEY_PREFIX) || key.length === KEY_PREFIX.length) {
    return undefined;
  }
  return key.slice(KEY_PREFIX.length);
}

/** A running job not saved for this long is taken to be dead: the browser or the background was closed under it. */
export const STALE_AFTER_MS = 10 * 60 * 1000;

/** True for a running job whose state was not saved for a long time. Finished jobs are never stale. */
export function isStale(state: JobState, now: number): boolean {
  return state.status === 'running' && now - state.updatedAt > STALE_AFTER_MS;
}

export function isJobState(value: unknown): value is JobState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<Record<keyof JobState, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.itemId === 'string' &&
    typeof candidate.title === 'string' &&
    STATUSES.includes(candidate.status as JobStatus) &&
    typeof candidate.doneSegments === 'number' &&
    typeof candidate.totalSegments === 'number' &&
    typeof candidate.bytes === 'number' &&
    typeof candidate.updatedAt === 'number'
  );
}

export class JobStateStore {
  constructor(private readonly area: JobAreaLike) {}

  async save(state: JobState): Promise<Result<void>> {
    try {
      await this.area.set({ [jobKey(state.id)]: state });
      return ok(undefined);
    } catch (error) {
      console.error(`StreamDraft: could not save the state of job ${state.id}`, error);
      return fail('The progress of the download could not be saved.');
    }
  }

  /** The saved state, or undefined when there is none or it is damaged. Never fails. */
  async load(jobId: string): Promise<JobState | undefined> {
    try {
      const stored = await this.area.get(jobKey(jobId));
      const value = stored[jobKey(jobId)];
      return isJobState(value) ? value : undefined;
    } catch (error) {
      console.error(`StreamDraft: could not read the state of job ${jobId}`, error);
      return undefined;
    }
  }

  /** Every saved job state; damaged entries are left out. Never fails. */
  async loadAll(): Promise<JobState[]> {
    try {
      const stored = await this.area.get(null);
      return Object.entries(stored)
        .filter(([key]) => jobIdFromKey(key) !== undefined)
        .map(([, value]) => value)
        .filter(isJobState);
    } catch (error) {
      console.error('StreamDraft: could not read the saved jobs', error);
      return [];
    }
  }

  async remove(jobId: string): Promise<Result<void>> {
    try {
      await this.area.remove(jobKey(jobId));
      return ok(undefined);
    } catch (error) {
      console.error(`StreamDraft: could not remove the state of job ${jobId}`, error);
      return fail('The record of the download could not be removed.');
    }
  }
}

/** Progress is saved at most this often; every save wakes the popup. */
export const MIN_SAVE_INTERVAL_MS = 500;

export interface JobIdentity {
  id: string;
  itemId: string;
  title: string;
}

/**
 * Saves a running job's progress, no more than twice a second, and its final
 * state always. Saves go out in order, so a late "running" never overwrites
 * the "done" that follows it.
 */
export class JobProgressReporter {
  private queue: Promise<unknown> = Promise.resolve();
  private lastSavedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly job: JobIdentity,
    private readonly store: Pick<JobStateStore, 'save'>,
    private readonly now: () => number,
    private readonly minIntervalMs: number = MIN_SAVE_INTERVAL_MS,
  ) {}

  /** The job has started and nothing is known yet. */
  start(totalSegments: number): Promise<void> {
    return this.enqueue('running', { doneSegments: 0, totalSegments, bytes: 0 });
  }

  /** Suits `SegmentJobOptions.onProgress`. */
  progress = (progress: JobProgress): void => {
    if (this.now() - this.lastSavedAt < this.minIntervalMs) {
      return;
    }
    void this.enqueue('running', progress);
  };

  /** Saves the end of the job and resolves when everything queued is saved. */
  finish(status: Exclude<JobStatus, 'running'>, progress: JobProgress, error?: string): Promise<void> {
    return this.enqueue(status, progress, error);
  }

  private enqueue(status: JobStatus, progress: JobProgress, error?: string): Promise<void> {
    this.lastSavedAt = this.now();
    const state: JobState = { ...this.job, status, ...progress, error, updatedAt: this.lastSavedAt };
    const saved = this.queue.then(() => this.store.save(state));
    this.queue = saved;
    return saved.then(() => undefined);
  }
}
