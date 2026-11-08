import { fail, ok, type Result } from '../core/result.ts';
import { CANCELLED_MESSAGE } from './cancelled.ts';
import type { FetchSegment, SegmentRequest } from './segment-fetcher.ts';
import type { SegmentStore } from './segment-store.ts';

export interface JobProgress {
  doneSegments: number;
  totalSegments: number;
  /** Bytes of the segments done, those found already stored included. */
  bytes: number;
}

export interface SegmentJobOptions {
  /** Segments fetched at the same time. */
  concurrency?: number;
  onProgress?: (progress: JobProgress) => void;
  /** Aborting stops the job at once: the result is `CANCELLED_MESSAGE`. */
  signal?: AbortSignal;
}

export const DEFAULT_CONCURRENCY = 4;

const NAME_DIGITS = 6;

/** The store name of the segment at this position of the list. */
export function segmentName(index: number): string {
  return `segment-${String(index).padStart(NAME_DIGITS, '0')}`;
}

/**
 * Fetches every segment into the store, a few at a time. A segment already in
 * the store is skipped, so running a job again continues where it stopped. The
 * first failure ends the job (the other fetches are aborted) and is reported
 * with the position of the segment.
 */
export async function runSegmentJob(
  requests: readonly SegmentRequest[],
  fetchSegment: FetchSegment,
  store: SegmentStore,
  options: SegmentJobOptions = {},
): Promise<Result<JobProgress>> {
  const total = requests.length;
  const userCancelled = (): boolean => options.signal?.aborted === true;
  if (userCancelled()) {
    return fail(CANCELLED_MESSAGE);
  }

  const own = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, own.signal]) : own.signal;
  const progress: JobProgress = { doneSegments: 0, totalSegments: total, bytes: 0 };
  let failure: string | undefined;
  let next = 0;

  function segmentDone(bytes: number): void {
    progress.doneSegments++;
    progress.bytes += bytes;
    options.onProgress?.({ ...progress });
  }

  async function fetchOne(index: number, request: SegmentRequest): Promise<Result<number>> {
    const fetched = await fetchSegment(request, signal);
    if (!fetched.ok) {
      return fetched;
    }
    return store.write(segmentName(index), fetched.value);
  }

  async function processOne(index: number, request: SegmentRequest): Promise<Result<number>> {
    const stored = await store.size(segmentName(index));
    if (stored !== undefined) {
      return ok(stored);
    }

    const done = await fetchOne(index, request);
    if (done.ok || done.error === CANCELLED_MESSAGE) {
      return done;
    }
    return fail(`Segment ${index + 1} of ${total}: ${done.error}`);
  }

  async function worker(): Promise<void> {
    while (failure === undefined && !signal.aborted) {
      const index = next++;
      const request = requests[index];
      if (request === undefined) {
        return;
      }

      const done = await processOne(index, request);
      if (!done.ok) {
        failure ??= done.error;
        own.abort();
        return;
      }
      segmentDone(done.value);
    }
  }

  const workers = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, total));
  await Promise.all(Array.from({ length: workers }, worker));

  if (failure !== undefined) {
    return fail(failure);
  }
  if (userCancelled()) {
    return fail(CANCELLED_MESSAGE);
  }
  return ok(progress);
}
