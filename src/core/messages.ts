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
