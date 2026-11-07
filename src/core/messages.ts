import type { MediaCandidate } from './media.ts';
import { fail, ok, type Result } from './result.ts';

/** Message the popup sends to the background to check that it is running. */
export const PING = 'ping';

export interface PongPayload {
  startedAt: number;
}

/**
 * Answers a runtime message. Pure function so it can be unit-tested without a
 * browser; the background script wires it to `runtime.onMessage`.
 */
export function handleMessage(message: unknown, startedAt: number): Result<PongPayload> {
  if (typeof message !== 'object' || message === null) {
    return fail('Message must be an object.');
  }

  const type = (message as { type?: unknown }).type;
  if (type !== PING) {
    return fail(`Unknown message type: ${String(type)}`);
  }

  return ok({ startedAt });
}

/** Message the background sends to a page to show the demo answer of the context menu entry. */
export const SHOW_DEMO_DOWNLOAD = 'show-demo-download';

export interface DemoDownloadMessage {
  type: typeof SHOW_DEMO_DOWNLOAD;
  text: string;
}

export function demoDownloadMessage(text: string): DemoDownloadMessage {
  return { type: SHOW_DEMO_DOWNLOAD, text };
}

/** Returns the text to show, or an error when `message` is not a demo download message. */
export function parseDemoDownloadMessage(message: unknown): Result<string> {
  if (typeof message !== 'object' || message === null) {
    return fail('Message must be an object.');
  }

  const { type, text } = message as { type?: unknown; text?: unknown };
  if (type !== SHOW_DEMO_DOWNLOAD || typeof text !== 'string') {
    return fail('Not a demo download message.');
  }
  return ok(text);
}

/** Message a page's content script sends to the background with the media files it found in the page. */
export const FOUND_MEDIA = 'found-media';

/** More than this in one message is ignored: the sender is a web page's neighbour, not trusted. */
export const MAX_CANDIDATES_PER_MESSAGE = 50;

export interface FoundMediaMessage {
  type: typeof FOUND_MEDIA;
  candidates: MediaCandidate[];
}

export function foundMediaMessage(candidates: MediaCandidate[]): FoundMediaMessage {
  return { type: FOUND_MEDIA, candidates };
}

/**
 * Returns the candidates of a found-media message, or an error when `message`
 * is not one. Only known text fields are taken over; the size is never taken
 * from a page (the network observer knows it better).
 */
export function parseFoundMediaMessage(message: unknown): Result<MediaCandidate[]> {
  if (typeof message !== 'object' || message === null) {
    return fail('Message must be an object.');
  }

  const { type, candidates } = message as { type?: unknown; candidates?: unknown };
  if (type !== FOUND_MEDIA || !Array.isArray(candidates)) {
    return fail('Not a found-media message.');
  }

  const parsed = candidates.slice(0, MAX_CANDIDATES_PER_MESSAGE).flatMap((entry): MediaCandidate[] => {
    const candidate = toCandidate(entry);
    return candidate ? [candidate] : [];
  });
  return ok(parsed);
}

function toCandidate(entry: unknown): MediaCandidate | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }

  const { url, contentType, pageUrl, pageTitle } = entry as Record<string, unknown>;
  if (typeof url !== 'string') {
    return undefined;
  }

  return {
    url,
    contentType: typeof contentType === 'string' ? contentType : undefined,
    pageUrl: typeof pageUrl === 'string' ? pageUrl : undefined,
    pageTitle: typeof pageTitle === 'string' ? pageTitle : undefined,
  };
}
