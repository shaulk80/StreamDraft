import { fail, ok, type Result } from '../core/result.ts';
import type { FetchText } from '../detect/manifest-fetch.ts';
import { CANCELLED_MESSAGE } from './cancelled.ts';
import type { EngineJob, EngineSignal, FinishedFile } from './engine-types.ts';
import { muxStreams } from './mux-job.ts';
import type { FileLike } from './opfs-store.ts';
import type { OutputSink } from './output-sink.ts';
import { SegmentDecryptor } from './segment-decryptor.ts';
import type { FetchSegment } from './segment-fetcher.ts';
import { runSegmentJob } from './segment-job.ts';
import type { SegmentStore } from './segment-store.ts';
import { planStream } from './stream-plan.ts';

/** The finished file: written like an output sink, readable once committed. */
export interface FinishedOutput extends OutputSink {
  file(): Promise<Result<FileLike>>;
}

/** The files of one job: the downloaded parts, and the place the joined video is written to. */
export interface JobFiles extends SegmentStore {
  createOutput(name: string): Promise<Result<FinishedOutput>>;
}

export interface StreamEngineDeps {
  /** Opens (and creates) the folder of a job. */
  openFiles(jobId: string): Promise<Result<JobFiles>>;
  fetchText: FetchText;
  fetchSegment: FetchSegment;
  /** A `blob:` address of the file; `mimeType` is what the browser names and opens the download by. */
  createObjectUrl(file: FileLike, mimeType: string): string;
  revokeObjectUrl(url: string): void;
  notify(signal: EngineSignal): void;
}

/** A job the engine holds: running, or finished and waiting for the browser to save the file. */
interface HeldJob {
  controller: AbortController;
  files?: JobFiles;
  url?: string;
}

const OUTPUT_NAME = 'output';
/** Chrome gives a download of a Blob without a type the extension of a text file. */
const MIME_TYPES = { mp4: 'video/mp4', m4a: 'audio/mp4' } as const;
const UNEXPECTED = 'The download stopped unexpectedly.';

/**
 * Downloads a stream in the background of the page it lives in: plans the
 * quality, fetches the parts into the job's folder, joins them into one file
 * there and makes a Blob address of it. Runs where a DOM and OPFS exist.
 */
export class StreamEngine {
  private readonly held = new Map<string, HeldJob>();

  constructor(private readonly deps: StreamEngineDeps) {}

  /** Begins the job and returns at once. Progress and the end are reported through `notify`. */
  start(job: EngineJob): Result<void> {
    if (this.held.has(job.jobId)) {
      return fail('A download with this name is already running.');
    }

    const entry: HeldJob = { controller: new AbortController() };
    this.held.set(job.jobId, entry);
    void this.run(job, entry);
    return ok(undefined);
  }

  /** How many jobs the engine holds: running, or finished and waiting to be released. */
  heldJobs(): number {
    return this.held.size;
  }

  cancel(jobId: string): void {
    const entry = this.held.get(jobId);
    if (entry !== undefined && entry.url === undefined) {
      entry.controller.abort();
    }
  }

  /** Removes the files and the Blob address of a job the browser is done with. */
  async release(jobId: string): Promise<void> {
    await this.discard(jobId);
    this.announceIdle();
  }

  private async run(job: EngineJob, entry: HeldJob): Promise<void> {
    const result = await this.execute(job, entry);
    if (!result.ok) {
      await this.discard(job.jobId);
    }
    this.deps.notify({ kind: 'finished', jobId: job.jobId, result });
    if (!result.ok) {
      this.announceIdle();
    }
  }

  private async execute(job: EngineJob, entry: HeldJob): Promise<Result<FinishedFile>> {
    try {
      return await this.download(job, entry);
    } catch (error) {
      console.error(`StreamDraft: download ${job.jobId} stopped unexpectedly`, error);
      return fail(UNEXPECTED);
    }
  }

  private async download(job: EngineJob, entry: HeldJob): Promise<Result<FinishedFile>> {
    const { signal } = entry.controller;
    const plan = await planStream(job.item, job.option, this.deps.fetchText);
    if (!plan.ok) {
      return plan;
    }
    if (signal.aborted) {
      return fail(CANCELLED_MESSAGE);
    }

    const files = await this.deps.openFiles(job.jobId);
    if (!files.ok) {
      return files;
    }
    entry.files = files.value;

    this.deps.notify({ kind: 'progress', jobId: job.jobId, progress: { doneSegments: 0, totalSegments: plan.value.requests.length, bytes: 0 } });
    const fetched = await runSegmentJob(plan.value.requests, this.deps.fetchSegment, files.value, {
      signal,
      onProgress: (progress) => this.deps.notify({ kind: 'progress', jobId: job.jobId, progress }),
    });
    if (!fetched.ok) {
      return fetched;
    }

    const decryptor = plan.value.encrypted ? SegmentDecryptor.withFetcher(this.deps.fetchSegment, signal) : undefined;
    const output = await files.value.createOutput(OUTPUT_NAME);
    if (!output.ok) {
      return output;
    }

    const joined = await muxStreams(plan.value.sources, files.value, output.value, { decryptor, signal, soundOnly: plan.value.soundOnly });
    if (!joined.ok) {
      await output.value.abort();
      return joined;
    }
    return this.finishOutput(job, entry, output.value, MIME_TYPES[joined.value.extension]);
  }

  /** Commits the joined file and makes the address the browser downloads it from. */
  private async finishOutput(job: EngineJob, entry: HeldJob, output: FinishedOutput, mimeType: string): Promise<Result<FinishedFile>> {
    const closed = await output.close();
    if (!closed.ok) {
      await output.abort();
      return closed;
    }

    const file = await output.file();
    if (!file.ok) {
      return file;
    }

    entry.url = this.deps.createObjectUrl(file.value, mimeType);
    return ok({ jobId: job.jobId, filename: job.filename, url: entry.url, bytes: file.value.size });
  }

  private async discard(jobId: string): Promise<void> {
    const entry = this.held.get(jobId);
    if (entry === undefined) {
      return;
    }

    this.held.delete(jobId);
    if (entry.url !== undefined) {
      this.deps.revokeObjectUrl(entry.url);
    }
    await entry.files?.clear();
  }

  private announceIdle(): void {
    if (this.held.size === 0) {
      this.deps.notify({ kind: 'idle' });
    }
  }
}
