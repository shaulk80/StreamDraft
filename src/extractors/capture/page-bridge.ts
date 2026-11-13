import { capturePost, parseCapturePost } from './capture-messages.ts';
import type { HookSink } from './media-hook.ts';
import type { CaptureEvent } from './types.ts';

/** The part of `window` the bridge uses on the content script's side. */
export interface MessageSource {
  addEventListener(type: 'message', listener: (event: { source: unknown; data: unknown }) => void): void;
}

/** The part of `window` the hook's sink uses on the page's side. */
export interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
  location: { origin: string };
}

/**
 * The content script's end of the line from the page-world hook: takes the
 * `window.postMessage` messages of the hook and hands the events to `handle`.
 * Messages from other windows, other channels and malformed ones are dropped;
 * the page can post here too, so the events are treated as untrusted page data.
 */
export function listenForCapture(source: MessageSource, handle: (event: CaptureEvent) => void): void {
  source.addEventListener('message', (event) => {
    if (event.source !== source) {
      return;
    }
    const parsed = parseCapturePost(event.data);
    if (parsed.ok) {
      handle(parsed.value);
    }
  });
}

/** The hook's sink for the page's side: posts every event to the content script, bytes transferred, not copied again. */
export function postingSink(target: MessageTarget): HookSink {
  const send = (event: CaptureEvent): void => {
    const { message, transfer } = capturePost(event);
    target.postMessage(message, target.location.origin, transfer);
  };
  return {
    bufferAdded: (event) => send({ kind: 'buffer', ...event }),
    appended: (event) => send({ kind: 'append', ...event }),
    encryptedMediaUsed: (api) => send({ kind: 'eme', api }),
  };
}
