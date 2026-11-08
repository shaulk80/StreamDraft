import { demoDownloadText, downloadFilename, type MediaItem, type QualityOption } from '../core/media.ts';
import { cancelJobMessage, downloadMediaMessage } from '../core/messages.ts';
import { fail, ok, type Result } from '../core/result.ts';
import type { Settings } from '../core/settings.ts';
import type { CancelJob } from './job-tracker.ts';

/** What came of a download request: the text to show, and the job to follow when the video is a stream. */
export interface DownloadReport {
  text: string;
  jobId?: string;
}

/**
 * What a "Download" button does for one video and quality. Resolves with what
 * happened, or with the reason it did not work.
 */
export type DownloadAction = (item: MediaItem, option: QualityOption) => Promise<Result<DownloadReport>>;

/** Sends a message to the background and gives its answer (`runtime.sendMessage`). */
export type SendMessage = (message: unknown) => Promise<unknown>;

/**
 * Asks the background to download. `tabId` is given by the popup (it is not
 * part of a tab); a page's tab is known to the background from the sender.
 */
export function backgroundDownloadAction(send: SendMessage, tabId?: number): DownloadAction {
  return async (item, option) => {
    let reply: unknown;
    try {
      reply = await send(downloadMediaMessage(item.id, option.quality, tabId));
    } catch (error) {
      console.error('StreamDraft: the background did not answer the download request', error);
      return fail('The extension did not answer. Reload the page and try again.');
    }
    return readReply(reply);
  };
}

/** Turns the background's answer (a Result with a file name, and a job for a stream) into what the popup shows. */
export function readReply(reply: unknown): Result<DownloadReport> {
  if (typeof reply !== 'object' || reply === null) {
    return fail('The extension gave no answer.');
  }

  const answer = reply as { ok?: unknown; value?: { filename?: unknown; jobId?: unknown }; error?: unknown };
  if (answer.ok === true && typeof answer.value?.filename === 'string') {
    const jobId = typeof answer.value.jobId === 'string' ? answer.value.jobId : undefined;
    return ok({ text: `Saving as "${answer.value.filename}".`, jobId });
  }
  if (answer.ok === false && typeof answer.error === 'string') {
    return fail(answer.error);
  }
  return fail('The extension gave an answer that was not understood.');
}

/** The M1 behaviour, for the sample videos shown with "?mock=1": says what would happen, downloads nothing. */
export function demoDownloadAction(settings: Settings): DownloadAction {
  return (item, option) => {
    const date = new Date().toISOString().slice(0, 10);
    const name = downloadFilename(item, option, settings.filenameTemplate, date);
    return Promise.resolve(ok({ text: demoDownloadText(name) }));
  };
}

/** Asks the background to stop a stream job. */
export function backgroundCancelAction(send: SendMessage): CancelJob {
  return async (jobId) => {
    try {
      await send(cancelJobMessage(jobId));
      return ok(undefined);
    } catch (error) {
      console.error('StreamDraft: the background did not answer the cancel request', error);
      return fail('The extension did not answer. Try again.');
    }
  };
}
