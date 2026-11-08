import { fail, ok, type Result } from '../core/result.ts';
import { CANCELLED_MESSAGE } from './cancelled.ts';

/** A part of a resource, as the manifest states it. */
export interface ByteRange {
  offset: number;
  length: number;
}

/** What to fetch: a whole file, or a part of one. */
export interface SegmentRequest {
  url: string;
  byteRange?: ByteRange;
}

/** The part of a `Response` the fetcher reads. */
export interface SegmentResponseLike {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type SegmentFetchLike = (
  url: string,
  init: { credentials: 'include'; signal: AbortSignal; headers: Record<string, string> },
) => Promise<SegmentResponseLike>;

/** Waits `ms` milliseconds, or less when the signal aborts. Injected so tests do not wait. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** Fetches one segment, with retries. Resolves with the bytes, or the reason in plain words. */
export type FetchSegment = (request: SegmentRequest, signal: AbortSignal) => Promise<Result<Uint8Array>>;

export interface SegmentFetcherOptions {
  /** Retries after the first attempt. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** One attempt, not the whole retry sequence. */
  attemptTimeoutMs?: number;
  sleep?: Sleep;
}

export const DEFAULT_RETRIES = 3;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 8_000;
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;

const TOO_MANY_REQUESTS = 429;
const REQUEST_TIMEOUT = 408;
const TOO_EARLY = 425;
const FIRST_SERVER_ERROR = 500;
const PARTIAL_CONTENT = 206;

interface Attempt {
  result: Result<Uint8Array>;
  /** Worth another try: a network error, a timeout, a busy or failing server. */
  retry: boolean;
}

/** Waits for the delay or the abort, whichever comes first. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function isRetryableStatus(status: number): boolean {
  return status >= FIRST_SERVER_ERROR || status === TOO_MANY_REQUESTS || status === REQUEST_TIMEOUT || status === TOO_EARLY;
}

function rangeHeader(range: ByteRange): string {
  return `bytes=${range.offset}-${range.offset + range.length - 1}`;
}

/**
 * The bytes of the wanted part. A server that ignores the range header answers
 * 200 with the whole file; the part is cut out here then.
 */
function wantedPart(bytes: Uint8Array, range: ByteRange | undefined, status: number): Uint8Array {
  if (range === undefined || status === PARTIAL_CONTENT) {
    return bytes;
  }
  return bytes.subarray(range.offset, range.offset + range.length);
}

/**
 * Builds the segment fetcher: one request per attempt with the user's cookies,
 * an own timeout per attempt, and exponential backoff between attempts. A
 * client error (404, 403) is final; a network error, a timeout and a busy or
 * failing server are retried.
 */
export function createSegmentFetcher(fetchLike: SegmentFetchLike, options: SegmentFetcherOptions = {}): FetchSegment {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const sleep = options.sleep ?? abortableSleep;

  async function attempt(request: SegmentRequest, signal: AbortSignal): Promise<Attempt> {
    const headers: Record<string, string> = request.byteRange ? { Range: rangeHeader(request.byteRange) } : {};
    try {
      const response = await fetchLike(request.url, {
        credentials: 'include',
        signal: AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]),
        headers,
      });
      if (!response.ok) {
        return { result: fail(`The server answered ${response.status}.`), retry: isRetryableStatus(response.status) };
      }

      const bytes = wantedPart(new Uint8Array(await response.arrayBuffer()), request.byteRange, response.status);
      if (request.byteRange !== undefined && bytes.length !== request.byteRange.length) {
        return { result: fail('The server sent an incomplete part of the file.'), retry: true };
      }
      return { result: ok(bytes), retry: false };
    } catch (error) {
      if (signal.aborted) {
        return { result: fail(CANCELLED_MESSAGE), retry: false };
      }
      console.error(`StreamDraft: could not fetch ${request.url}`, error);
      return { result: fail('The connection failed or timed out.'), retry: true };
    }
  }

  return async (request, signal) => {
    for (let tried = 0; ; tried++) {
      if (signal.aborted) {
        return fail(CANCELLED_MESSAGE);
      }

      const outcome = await attempt(request, signal);
      if (outcome.result.ok || !outcome.retry || tried >= retries) {
        return outcome.result;
      }
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** tried), signal);
    }
  };
}
