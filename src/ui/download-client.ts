import { demoDownloadText, downloadFilename, type MediaItem, type QualityOption } from '../core/media.ts';
import { downloadMediaMessage } from '../core/messages.ts';
import { fail, ok, type Result } from '../core/result.ts';
import type { Settings } from '../core/settings.ts';

/**
 * What a "Download" button does for one video and quality. Resolves with the
 * text to show the user: what happened, or why it did not work.
 */
export type DownloadAction = (item: MediaItem, option: QualityOption) => Promise<Result<string>>;

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

/** Turns the background's answer (a Result with a file name) into the text for the user. */
export function readReply(reply: unknown): Result<string> {
  if (typeof reply !== 'object' || reply === null) {
    return fail('The extension gave no answer.');
  }

  const answer = reply as { ok?: unknown; value?: { filename?: unknown }; error?: unknown };
  if (answer.ok === true && typeof answer.value?.filename === 'string') {
    return ok(`Saving as "${answer.value.filename}".`);
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
    return Promise.resolve(ok(demoDownloadText(name)));
  };
}
