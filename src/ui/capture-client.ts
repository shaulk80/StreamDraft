import { captureCommandMessage, type CaptureCommand } from '../extractors/capture/capture-commands.ts';
import type { CaptureSnapshot } from '../extractors/capture/types.ts';
import { fail, ok, type Result } from '../core/result.ts';
import type { SendMessage } from './download-client.ts';

/** A recording that was handed to the engine: the file it will be saved as and the job to follow. */
export interface SavedRecording {
  filename: string;
  jobId: string;
}

/** What the popup asks of the background about the player capture of one tab. */
export interface CaptureClient {
  /** Marks the tab and reloads it. */
  arm(): Promise<Result<void>>;
  /** How the recording stands; an error when the page has no capture script (not a listed site, or not loaded yet). */
  status(): Promise<Result<CaptureSnapshot>>;
  save(soundOnly: boolean): Promise<Result<SavedRecording>>;
  discard(): Promise<Result<void>>;
}

const NO_ANSWER = 'The extension did not answer. Reload the page and try again.';

function isSnapshot(value: unknown): value is CaptureSnapshot {
  const candidate = value as Partial<CaptureSnapshot> | null;
  return typeof candidate === 'object' && candidate !== null && Array.isArray(candidate.buffers) && Array.isArray(candidate.missing);
}

function isSaved(value: unknown): value is SavedRecording {
  const candidate = value as Partial<SavedRecording> | null;
  return typeof candidate === 'object' && candidate !== null && typeof candidate.filename === 'string' && typeof candidate.jobId === 'string';
}

/** The capture commands of the background, sent as messages for the tab of the popup. */
export function backgroundCaptureClient(send: SendMessage, tabId: number): CaptureClient {
  /** Sends the command; the answer is the background's `Result`, checked with `read` before it is believed. */
  const ask = async <T>(command: CaptureCommand, read: (value: unknown) => Result<T>): Promise<Result<T>> => {
    let reply: unknown;
    try {
      reply = await send(captureCommandMessage(command));
    } catch (error) {
      console.error(`StreamDraft: the background did not answer the ${command.kind} request`, error);
      return fail(NO_ANSWER);
    }

    const answer = reply as { ok?: unknown; value?: unknown; error?: unknown } | null | undefined;
    if (answer?.ok === true) {
      return read(answer.value);
    }
    return fail(typeof answer?.error === 'string' ? answer.error : NO_ANSWER);
  };

  return {
    arm: () => ask({ kind: 'arm', tabId }, () => ok(undefined)),
    status: () => ask({ kind: 'status', tabId }, (value) => (isSnapshot(value) ? ok(value) : fail(NO_ANSWER))),
    save: (soundOnly) => ask({ kind: 'save', tabId, soundOnly }, (value) => (isSaved(value) ? ok(value) : fail(NO_ANSWER))),
    discard: () => ask({ kind: 'discard', tabId }, () => ok(undefined)),
  };
}
