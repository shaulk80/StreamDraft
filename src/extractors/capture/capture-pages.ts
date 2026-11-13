import { fail, ok, type Result } from '../../core/result.ts';
import type { RecordingInput } from '../../engine/recording-input.ts';
import { pageRequestMessage, type PageRequest } from './capture-commands.ts';
import type { CapturePages } from './capture-service.ts';
import type { CaptureSnapshot } from './types.ts';

/** The browser calls the page channel needs (`scripting`, `tabs`), so tests can stand in for them. */
export interface PagesApi {
  /** Writes the arm mark into the tab's `sessionStorage`; false when the page does not allow it. */
  setArmMark(tabId: number): Promise<boolean>;
  reload(tabId: number): Promise<void>;
  /** Sends a message to the top frame of the tab; rejects when nothing there listens. */
  send(tabId: number, message: unknown): Promise<unknown>;
}

const NOT_ARMED = 'This page is not being recorded. Press Record, which reloads the page, and let the video play.';
const CANNOT_MARK = 'The page would not let StreamDraft prepare it for recording. Reload the page and try again.';
const CANNOT_RELOAD = 'The page could not be reloaded.';
const NO_ANSWER = 'The page gave no answer. Press Record again.';

/** A `Result` that came through a message: the shape is checked, the value is for the caller to check. */
function asResult(reply: unknown): Result<unknown> {
  if (typeof reply !== 'object' || reply === null) {
    return fail(NO_ANSWER);
  }

  const answer = reply as { ok?: unknown; value?: unknown; error?: unknown };
  if (answer.ok === true) {
    return ok(answer.value);
  }
  return fail(typeof answer.error === 'string' ? answer.error : NO_ANSWER);
}

/** Talks to the capture script of a page: the mark that arms a load, and the three requests about its recording. */
export class BrowserCapturePages implements CapturePages {
  constructor(private readonly api: PagesApi) {}

  async arm(tabId: number): Promise<Result<void>> {
    try {
      return (await this.api.setArmMark(tabId)) ? ok(undefined) : fail(CANNOT_MARK);
    } catch (error) {
      console.error(`StreamDraft: could not mark tab ${tabId} for recording`, error);
      return fail(CANNOT_MARK);
    }
  }

  async reload(tabId: number): Promise<Result<void>> {
    try {
      await this.api.reload(tabId);
      return ok(undefined);
    } catch (error) {
      console.error(`StreamDraft: could not reload tab ${tabId}`, error);
      return fail(CANNOT_RELOAD);
    }
  }

  async status(tabId: number): Promise<Result<CaptureSnapshot>> {
    const reply = await this.ask(tabId, 'status');
    return reply.ok ? ok(reply.value as CaptureSnapshot) : reply;
  }

  async save(tabId: number): Promise<Result<RecordingInput>> {
    const reply = await this.ask(tabId, 'save');
    return reply.ok ? ok(reply.value as RecordingInput) : reply;
  }

  async discard(tabId: number): Promise<Result<void>> {
    const reply = await this.ask(tabId, 'discard');
    return reply.ok ? ok(undefined) : reply;
  }

  private async ask(tabId: number, request: PageRequest): Promise<Result<unknown>> {
    try {
      return asResult(await this.api.send(tabId, pageRequestMessage(request)));
    } catch (error) {
      // Normal for a page that was not loaded with the capture script: no one is listening.
      console.error(`StreamDraft: tab ${tabId} did not answer a capture request`, error);
      return fail(NOT_ARMED);
    }
  }
}
