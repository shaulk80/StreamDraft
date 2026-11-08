import { fail, ok, type Result } from '../core/result.ts';

/** A manifest larger than this is not a manifest (or not worth reading into memory). */
export const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;

/** The text of a manifest and the address it came from after redirects (relative addresses resolve against it). */
export interface FetchedText {
  text: string;
  url: string;
}

export type FetchText = (url: string) => Promise<Result<FetchedText>>;

/** The part of a `Response` the fetcher reads. */
export interface ResponseLike {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: { credentials: 'include'; signal: AbortSignal }) => Promise<ResponseLike>;

const TOO_LARGE = 'The stream\'s playlist is too large to read.';

function contentLengthOf(response: ResponseLike): number | undefined {
  const header = response.headers.get('content-length')?.trim() ?? '';
  return /^\d+$/.test(header) ? Number(header) : undefined;
}

/**
 * Reads a manifest the way the page would: with the user's cookies, giving up
 * after a timeout. Failures come back as a message for the popup (the cause is logged).
 */
export function createManifestFetcher(fetchLike: FetchLike, timeoutMs: number = FETCH_TIMEOUT_MS): FetchText {
  return async (url) => {
    try {
      const response = await fetchLike(url, { credentials: 'include', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        return fail(`The stream's playlist could not be loaded (the server answered ${response.status}).`);
      }

      const length = contentLengthOf(response);
      if (length !== undefined && length > MAX_MANIFEST_BYTES) {
        return fail(TOO_LARGE);
      }

      const text = await response.text();
      if (text.length > MAX_MANIFEST_BYTES) {
        return fail(TOO_LARGE);
      }
      return ok({ text, url: response.url === '' ? url : response.url });
    } catch (error) {
      console.error(`StreamDraft: could not load the playlist ${url}`, error);
      return fail('The stream\'s playlist could not be loaded. Check the connection and try again.');
    }
  };
}
