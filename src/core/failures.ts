/**
 * What the user reads when a download fails: in plain words, with what to do next.
 * The messages travel as the `error` of a `Result` and are saved in the job state, so
 * the UI cannot ask the failure what it was; `isRetryable` knows which messages a new try can fix.
 */

export const NETWORK_FAILED = 'The connection to the video server failed. Check your internet connection and try again.';
export const SERVER_BUSY = 'The video server is busy or not answering. Try again in a few minutes.';
export const ADDRESS_EXPIRED =
  'The video server refused access, or the address of the video has expired. Reload the page, play the video again, then download it.';
export const PART_GONE = 'The video server no longer has a part of the video. Reload the page and try again.';
export const DISK_FULL = 'The video could not be written to disk. The disk may be full: free some space and try again.';
export const PAGE_GONE = 'The page that was recorded was closed or reloaded, so the recording is gone. Record the page again.';
export const UNEXPECTED = 'The download stopped unexpectedly. Try again.';

export const NOT_SAVED = 'The browser could not save the finished video. Check that the download folder exists and has free space, then try again.';
export const NOT_STARTED = 'The browser could not start saving the finished video. Try again.';
export const SAVE_NO_SPACE = 'There is not enough free disk space to save the video. Free some space and try again.';
export const SAVE_DENIED = 'The browser is not allowed to write to the download folder. Choose another folder in the browser settings and try again.';
export const NAME_TOO_LONG = 'The file name is too long for the disk. Shorten the file name in the StreamDraft settings and try again.';

/** The failures a new try can fix: a lost connection, a busy server, a full disk, a folder that was missing. */
const RETRYABLE: ReadonlySet<string> = new Set([
  NETWORK_FAILED,
  SERVER_BUSY,
  DISK_FULL,
  UNEXPECTED,
  NOT_SAVED,
  NOT_STARTED,
  SAVE_NO_SPACE,
  SAVE_DENIED,
  NAME_TOO_LONG,
]);

/** True when trying the same download again can work. An expired address or a closed page needs more than that. */
export function isRetryable(message: string | undefined): boolean {
  return message !== undefined && RETRYABLE.has(message);
}

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const GONE = 410;
const FIRST_SERVER_ERROR = 500;
const BUSY_STATUSES: readonly number[] = [408, 425, 429];

/** The words for a server's answer that is not a success. */
export function httpFailure(status: number): string {
  if (status === UNAUTHORIZED || status === FORBIDDEN) {
    return ADDRESS_EXPIRED;
  }
  if (status === NOT_FOUND || status === GONE) {
    return PART_GONE;
  }
  if (status >= FIRST_SERVER_ERROR || BUSY_STATUSES.includes(status)) {
    return SERVER_BUSY;
  }
  return `The video server answered ${status}, which StreamDraft cannot use.`;
}

/** The words for the reason the browser gave when it interrupted the save of the finished file. */
export function saveFailure(reason: string | undefined): string {
  switch (reason) {
    case 'FILE_NO_SPACE':
      return SAVE_NO_SPACE;
    case 'FILE_ACCESS_DENIED':
      return SAVE_DENIED;
    case 'FILE_NAME_TOO_LONG':
      return NAME_TOO_LONG;
    default:
      return NOT_SAVED;
  }
}
