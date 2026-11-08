import type { MediaItem, QualityOption } from '../core/media.ts';
import type { Result } from '../core/result.ts';
import type { JobProgress } from './segment-job.ts';

/** One stream download, as the background hands it to the engine. Plain data: it travels in messages. */
export interface EngineJob {
  /** Names the job's folder in the private file system: letters, digits, `-` and `_`. */
  jobId: string;
  /** The file name the browser saves the video under. */
  filename: string;
  item: MediaItem;
  option: QualityOption;
}

/** The finished video, ready for the browser to save. */
export interface FinishedFile {
  jobId: string;
  filename: string;
  /** A `blob:` address of the file in the private file system; valid until the job is released. */
  url: string;
  bytes: number;
}

/** What the engine tells the background about a job. */
export type EngineEvent =
  | { kind: 'progress'; jobId: string; progress: JobProgress }
  | { kind: 'finished'; jobId: string; result: Result<FinishedFile> };

/** An event, or the news that the engine holds no job any more (the Chrome offscreen document can be closed then). */
export type EngineSignal = EngineEvent | { kind: 'idle' };

/**
 * Where the engine runs. Firefox runs it in the background page, Chrome in an
 * offscreen document (decision 0003). The answers come back as `EngineEvent`s,
 * not as return values: the background can be stopped and woken in between.
 */
export interface EngineHost {
  /** Begins the job and returns at once; progress and the end arrive as events. */
  start(job: EngineJob): Promise<Result<void>>;
  /** Stops a running job; it ends with a `finished` event that says it was cancelled. */
  cancel(jobId: string): Promise<void>;
  /** The browser has saved (or given up on) the file: removes the temporary files and the Blob address. */
  release(jobId: string): Promise<void>;
}
