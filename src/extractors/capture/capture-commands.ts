import { fail, ok, type Result } from '../../core/result.ts';

/** The popup (or a test) asks the background to do something with the player capture of a tab. */
export const CAPTURE_COMMAND = 'capture-command';

export type CaptureCommand =
  /** Marks the tab's next load for recording and reloads it. */
  | { kind: 'arm'; tabId: number }
  /** How the recording of the tab stands; the answer is a `Result<CaptureSnapshot>`. */
  | { kind: 'status'; tabId: number }
  /** Joins the finished recording and saves it; the answer is a `Result<{ filename, jobId }>`. */
  | { kind: 'save'; tabId: number; soundOnly: boolean }
  /** Throws the recording away. */
  | { kind: 'discard'; tabId: number };

export function captureCommandMessage(command: CaptureCommand): { type: typeof CAPTURE_COMMAND; command: CaptureCommand } {
  return { type: CAPTURE_COMMAND, command };
}

/** The command of a capture-command message, or an error when `message` is not one. */
export function parseCaptureCommandMessage(message: unknown): Result<CaptureCommand> {
  const body = typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : undefined;
  const command = typeof body?.['command'] === 'object' && body['command'] !== null ? (body['command'] as Record<string, unknown>) : undefined;
  if (body?.['type'] !== CAPTURE_COMMAND || command === undefined) {
    return fail('Not a capture command.');
  }

  const tabId = command['tabId'];
  if (typeof tabId !== 'number' || !Number.isInteger(tabId)) {
    return fail('The capture command names no tab.');
  }

  switch (command['kind']) {
    case 'arm':
    case 'status':
    case 'discard':
      return ok({ kind: command['kind'], tabId });
    case 'save':
      return ok({ kind: 'save', tabId, soundOnly: command['soundOnly'] === true });
    default:
      return fail('The capture command is not understood.');
  }
}

/** The background asks the capture script of a page (a content script) how the recording stands, for the recording, or to drop it. */
export const CAPTURE_PAGE_REQUEST = 'capture-page-request';

export type PageRequest = 'status' | 'save' | 'discard';

export function pageRequestMessage(request: PageRequest): { type: typeof CAPTURE_PAGE_REQUEST; request: PageRequest } {
  return { type: CAPTURE_PAGE_REQUEST, request };
}

export function parsePageRequestMessage(message: unknown): Result<PageRequest> {
  const body = typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : undefined;
  const request = body?.['request'];
  if (body?.['type'] === CAPTURE_PAGE_REQUEST && (request === 'status' || request === 'save' || request === 'discard')) {
    return ok(request);
  }
  return fail('Not a capture page request.');
}
