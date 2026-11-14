import type { MediaItem, QualityOption } from '../core/media.ts';
import { ok, type Result } from '../core/result.ts';
import { CANCELLED_MESSAGE } from './cancelled.ts';
import type { EngineEvent, EngineHost, FinishedFile } from './engine-types.ts';
import { JobProgressReporter, type JobAreaLike, type JobIdentity, type JobState, type JobStateStore, type JobStatus } from './job-state.ts';
import type { RecordingInput } from './recording-input.ts';
import type { JobProgress } from './segment-job.ts';

/** The part of `browser.downloads` the hand-off uses. */
export interface HandoffDownloads {
  download(options: { url: string; filename: string; conflictAction: 'uniquify' }): Promise<number>;
  search(query: { id: number }): Promise<{ state?: string; error?: string }[]>;
}

/** What `downloads.onChanged` tells about one download. */
export interface DownloadChange {
  id: number;
  state?: { current?: string };
  error?: { current?: string };
}

export interface StreamRequest {
  item: MediaItem;
  option: QualityOption;
  filename: string;
  /** A captured recording to join (the item is then of kind `capture`) instead of a stream to fetch. */
  recording?: RecordingInput;
}

export interface StartedStream {
  jobId: string;
}

/** Starts the download of a stream; what `DownloadService` calls for HLS and DASH videos. */
export interface StreamStarter {
  start(request: StreamRequest): Promise<Result<StartedStream>>;
}

export interface JobCoordinatorDeps {
  host: EngineHost;
  downloads: HandoffDownloads;
  states: Pick<JobStateStore, 'save' | 'load'>;
  /** Remembers which job a browser download belongs to; the background can be stopped meanwhile. */
  handoffs: DownloadHandoffs;
  newJobId(): string;
  now(): number;
}

const HANDOFF_PREFIX = 'streamdraft.handoff.';
const USER_CANCELED = 'USER_CANCELED';
const NOT_SAVED = 'The browser could not save the finished video.';
const NOT_STARTED = 'The browser could not start saving the finished video.';
/**
 * How long one save may keep the next one waiting. The trouble (issue #23) is two saves of one file
 * name started in the same instant, not two a few seconds apart, so the next one need not wait for a big
 * file to be written.
 */
const SAVE_TURN_MS = 5000;
const ZERO_PROGRESS: JobProgress = { doneSegments: 0, totalSegments: 0, bytes: 0 };

/**
 * A finished file given to the browser's downloads. The address and name are kept so that the save
 * can be started once more when the browser interrupts it, also by a background that was woken since.
 */
export interface Handoff {
  jobId: string;
  url: string;
  filename: string;
  /** True for the second try; a second interruption ends the job. */
  retried: boolean;
}

function isHandoff(value: unknown): value is Handoff {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Handoff>;
  return typeof candidate.jobId === 'string' && typeof candidate.url === 'string' && typeof candidate.filename === 'string' && typeof candidate.retried === 'boolean';
}

/** Which job a browser download belongs to, kept in a storage area (`storage.session`). */
export class DownloadHandoffs {
  constructor(private readonly area: JobAreaLike) {}

  async remember(downloadId: number, handoff: Handoff): Promise<void> {
    try {
      await this.area.set({ [`${HANDOFF_PREFIX}${downloadId}`]: handoff });
    } catch (error) {
      console.error(`StreamDraft: could not remember download ${downloadId}`, error);
    }
  }

  /** The hand-off of the download, forgotten at the same time; undefined for a download that is not ours. */
  async take(downloadId: number): Promise<Handoff | undefined> {
    const key = `${HANDOFF_PREFIX}${downloadId}`;
    try {
      const stored = (await this.area.get(key))[key];
      if (!isHandoff(stored)) {
        return undefined;
      }
      await this.area.remove(key);
      return stored;
    } catch (error) {
      console.error(`StreamDraft: could not look up download ${downloadId}`, error);
      return undefined;
    }
  }
}

interface TrackedJob {
  reporter: JobProgressReporter;
  last: JobProgress;
}

/**
 * Runs in the background: starts stream jobs on the engine host, keeps their
 * state for the popup, hands each finished file to the browser's downloads and
 * lets the engine clean up once the browser is done with it. Holds nothing
 * that matters in memory: every step can be taken after the background was
 * stopped and woken again.
 */
export class JobCoordinator implements StreamStarter {
  private readonly tracked = new Map<string, TrackedJob>();
  /**
   * Finished files are given to the browser one at a time: Firefox picks the name of a file ("name (1)")
   * when its download starts, and two downloads of one name started in the same instant can get the same
   * name (one file then replaces the other) or make the browser interrupt one of them. Kept in memory
   * only: it matters for a few seconds, and a woken background starts with nothing waiting.
   */
  private turn: Promise<void> = Promise.resolve();
  /** What lets the next save start, by the id of the browser download that holds the turn. */
  private readonly endTurns = new Map<number, () => void>();

  constructor(private readonly deps: JobCoordinatorDeps) {}

  async start(request: StreamRequest): Promise<Result<StartedStream>> {
    const identity: JobIdentity = { id: this.deps.newJobId(), itemId: request.item.id, title: request.item.title };
    const job = this.track(identity, ZERO_PROGRESS);
    await job.reporter.start(0);

    const started = await this.deps.host.start({
      jobId: identity.id,
      filename: request.filename,
      item: request.item,
      option: request.option,
      recording: request.recording,
    });
    if (!started.ok) {
      await job.reporter.finish('failed', job.last, started.error);
      this.tracked.delete(identity.id);
      return started;
    }
    return ok({ jobId: identity.id });
  }

  /** Stops a job that is still fetching or joining. */
  async cancel(jobId: string): Promise<void> {
    await this.deps.host.cancel(jobId);
  }

  async handleEvent(event: EngineEvent): Promise<void> {
    if (event.kind === 'progress') {
      await this.onProgress(event.jobId, event.progress);
      return;
    }
    if (event.result.ok) {
      await this.hand(event.result.value);
      return;
    }
    await this.end(event.jobId, event.result.error === CANCELLED_MESSAGE ? 'cancelled' : 'failed', event.result.error);
  }

  async handleDownloadChange(change: DownloadChange): Promise<void> {
    const state = change.state?.current;
    if (state !== 'complete' && state !== 'interrupted') {
      return;
    }

    this.endTurn(change.id);
    const handoff = await this.deps.handoffs.take(change.id);
    if (handoff === undefined) {
      return;
    }

    const reason = change.error?.current;
    // Firefox can interrupt one of two same-name downloads started in the same instant (issue #23).
    // The file is still in the extension's storage, so one more try is made; a cancel is the user's own.
    if (state === 'interrupted' && reason !== USER_CANCELED && !handoff.retried) {
      console.error(`StreamDraft: the browser interrupted the save of ${handoff.filename} (${String(reason)}); trying once more`);
      await this.save({ ...handoff, retried: true });
      return;
    }
    await this.endHandoff(handoff.jobId, state, reason);
  }

  private async onProgress(jobId: string, progress: JobProgress): Promise<void> {
    const job = await this.find(jobId);
    if (job === undefined) {
      return;
    }

    job.last = progress;
    job.reporter.progress(progress);
  }

  /** Gives the finished file to the browser's downloads. */
  private async hand(file: FinishedFile): Promise<void> {
    await this.save({ jobId: file.jobId, url: file.url, filename: file.filename, retried: false });
  }

  /** Starts the browser's save of the file; it ends the job when the browser will not even start it. */
  private async save(handoff: Handoff): Promise<void> {
    const endTurn = await this.waitForTurn();
    let downloadId: number;
    try {
      downloadId = await this.deps.downloads.download({ url: handoff.url, filename: handoff.filename, conflictAction: 'uniquify' });
    } catch (error) {
      endTurn();
      console.error(`StreamDraft: the browser refused to save ${handoff.filename}`, error);
      await this.end(handoff.jobId, 'failed', NOT_STARTED);
      await this.deps.host.release(handoff.jobId);
      return;
    }

    this.endTurns.set(downloadId, endTurn);
    await this.deps.handoffs.remember(downloadId, handoff);
    // A small file can be saved before the answer above is stored.
    const [current] = await this.searchDownload(downloadId);
    if (current?.state === 'complete' || current?.state === 'interrupted') {
      await this.handleDownloadChange({ id: downloadId, state: { current: current.state }, error: { current: current.error } });
    }
  }

  /** Waits until the save before this one has ended; the result lets the next save start. */
  private async waitForTurn(): Promise<() => void> {
    const before = this.turn;
    let passOn: () => void = () => undefined;
    this.turn = new Promise<void>((resolve) => {
      passOn = resolve;
    });
    await before;

    const timer = setTimeout(passOn, SAVE_TURN_MS);
    return () => {
      clearTimeout(timer);
      passOn();
    };
  }

  private endTurn(downloadId: number): void {
    const endTurn = this.endTurns.get(downloadId);
    if (endTurn === undefined) {
      return;
    }
    this.endTurns.delete(downloadId);
    endTurn();
  }

  private async searchDownload(id: number): Promise<{ state?: string; error?: string }[]> {
    try {
      return await this.deps.downloads.search({ id });
    } catch (error) {
      console.error(`StreamDraft: could not look up download ${id}`, error);
      return [];
    }
  }

  private async endHandoff(jobId: string, state: 'complete' | 'interrupted', error: string | undefined): Promise<void> {
    if (state === 'complete') {
      await this.end(jobId, 'done');
    } else if (error === USER_CANCELED) {
      await this.end(jobId, 'cancelled');
    } else {
      await this.end(jobId, 'failed', NOT_SAVED);
    }
    await this.deps.host.release(jobId);
  }

  /** Saves the last state of a job. */
  private async end(jobId: string, status: Exclude<JobStatus, 'running'>, error?: string): Promise<void> {
    const job = await this.find(jobId);
    if (job === undefined) {
      return;
    }

    const progress = status === 'done' ? { ...job.last, doneSegments: job.last.totalSegments } : job.last;
    await job.reporter.finish(status, progress, error);
    this.tracked.delete(jobId);
  }

  private track(identity: JobIdentity, last: JobProgress): TrackedJob {
    const job: TrackedJob = { reporter: new JobProgressReporter(identity, this.deps.states, this.deps.now), last };
    this.tracked.set(identity.id, job);
    return job;
  }

  /** The job in memory, or rebuilt from its saved state when the background was restarted. */
  private async find(jobId: string): Promise<TrackedJob | undefined> {
    const known = this.tracked.get(jobId);
    if (known !== undefined) {
      return known;
    }

    const saved: JobState | undefined = await this.deps.states.load(jobId);
    if (saved === undefined || saved.status !== 'running') {
      return undefined;
    }
    return this.track(
      { id: saved.id, itemId: saved.itemId, title: saved.title },
      { doneSegments: saved.doneSegments, totalSegments: saved.totalSegments, bytes: saved.bytes },
    );
  }
}
