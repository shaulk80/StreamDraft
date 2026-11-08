import { isStale, type JobState } from '../engine/job-state.ts';
import type { Result } from '../core/result.ts';

/** Where the tracker learns about jobs: their saved states and every later save. */
export interface JobSource {
  loadAll(): Promise<JobState[]>;
  onChange(listener: (state: JobState) => void): void;
}

export type JobListener = (state: JobState) => void;

/** What the video cards need to follow and stop stream jobs. */
export interface JobsView {
  /** The job of this video that is still running, if any (the popup was closed and opened again). */
  runningFor(itemId: string): JobState | undefined;
  /** Calls the listener with the last known state, if there is one, and again on every change until the job ends. */
  watch(jobId: string, listener: JobListener): void;
  cancel(jobId: string): Promise<Result<void>>;
}

/** Asks the background to stop a job. */
export type CancelJob = (jobId: string) => Promise<Result<void>>;

/**
 * Keeps the last known state of every job for the popup. The background saves
 * the states in `storage.local`; the popup only reads them, so a job goes on
 * while the popup is closed and is found again when it opens.
 */
export class JobTracker implements JobsView {
  private readonly states = new Map<string, JobState>();
  private readonly listeners = new Map<string, Set<JobListener>>();

  constructor(
    private readonly source: JobSource,
    private readonly requestCancel: CancelJob,
    private readonly now: () => number,
  ) {}

  /** Reads the saved states and follows the changes from now on. */
  async start(): Promise<void> {
    // Subscribed first: a change that comes while the states load must not be lost.
    this.source.onChange((state) => this.update(state));
    for (const state of await this.source.loadAll()) {
      this.keepNewer(state);
    }
  }

  runningFor(itemId: string): JobState | undefined {
    const now = this.now();
    const running = [...this.states.values()].filter(
      (state) => state.itemId === itemId && state.status === 'running' && !isStale(state, now),
    );
    return running.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  }

  watch(jobId: string, listener: JobListener): void {
    const known = this.states.get(jobId);
    if (known !== undefined) {
      listener(known);
    }
    if (known !== undefined && known.status !== 'running') {
      return;
    }

    const set = this.listeners.get(jobId) ?? new Set<JobListener>();
    set.add(listener);
    this.listeners.set(jobId, set);
  }

  cancel(jobId: string): Promise<Result<void>> {
    return this.requestCancel(jobId);
  }

  private update(state: JobState): void {
    if (!this.keepNewer(state)) {
      return;
    }
    for (const listener of [...(this.listeners.get(state.id) ?? [])]) {
      listener(state);
    }
    // An ended job saves nothing more, so nobody needs to wait for it.
    if (state.status !== 'running') {
      this.listeners.delete(state.id);
    }
  }

  /** Stores the state unless an equal or newer one is known; says whether it was stored. */
  private keepNewer(state: JobState): boolean {
    const known = this.states.get(state.id);
    if (known !== undefined && known.updatedAt > state.updatedAt) {
      return false;
    }
    this.states.set(state.id, state);
    return true;
  }
}
