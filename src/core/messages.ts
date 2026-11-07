import { isQuality, type Quality } from './settings.ts';
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

/** Message the background sends to a page to show a short text in a toast (the answer to a context menu click). */
export const SHOW_TEXT = 'show-text';

export interface ShowTextMessage {
  type: typeof SHOW_TEXT;
  text: string;
}

export function showTextMessage(text: string): ShowTextMessage {
  return { type: SHOW_TEXT, text };
}

/** Returns the text to show, or an error when `message` is not a show-text message. */
export function parseShowTextMessage(message: unknown): Result<string> {
  if (typeof message !== 'object' || message === null) {
    return fail('Message must be an object.');
  }

  const { type, text } = message as { type?: unknown; text?: unknown };
  if (type !== SHOW_TEXT || typeof text !== 'string') {
    return fail('Not a show-text message.');
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

/** Message a popup or page sends to the background to download one of the videos found on a tab. */
export const DOWNLOAD_MEDIA = 'download-media';

export interface DownloadMediaMessage {
  type: typeof DOWNLOAD_MEDIA;
  itemId: string;
  quality: Quality;
  /** Needed from the popup, which is not part of a tab; a page's tab is known from the sender. */
  tabId?: number;
}

export function downloadMediaMessage(itemId: string, quality: Quality, tabId?: number): DownloadMediaMessage {
  return { type: DOWNLOAD_MEDIA, itemId, quality, tabId };
}

/** Returns the request, or an error when `message` is not a valid download message. */
export function parseDownloadMediaMessage(message: unknown): Result<DownloadMediaMessage> {
  if (typeof message !== 'object' || message === null) {
    return fail('Message must be an object.');
  }

  const { type, itemId, quality, tabId } = message as Record<string, unknown>;
  if (type !== DOWNLOAD_MEDIA) {
    return fail('Not a download message.');
  }
  if (typeof itemId !== 'string' || itemId === '') {
    return fail('The download message names no video.');
  }
  if (!isQuality(quality)) {
    return fail('The download message has no valid quality.');
  }
  if (tabId !== undefined && !Number.isInteger(tabId)) {
    return fail('The download message has no valid tab.');
  }
  return ok({ type: DOWNLOAD_MEDIA, itemId, quality, tabId: tabId as number | undefined });
}

/**
 * Message the popup sends to a page's content script to make it look at its videos
 * again and report all of them (the popup's "Refresh" button). The answer is a
 * `Result<number>`: how many media files the page has.
 */
export const RESCAN_MEDIA = 'rescan-media';

export function rescanMediaMessage(): { type: typeof RESCAN_MEDIA } {
  return { type: RESCAN_MEDIA };
}

export function isRescanMediaMessage(message: unknown): boolean {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === RESCAN_MEDIA;
}
