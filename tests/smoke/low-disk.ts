import { existsSync, rmSync } from 'node:fs';
import { DISK_FULL } from '../../src/core/failures.ts';
import type { PopupPage } from './job-display.ts';
import { FAILED_TEXT, LARGE_CHECK, SAVED_TEXT, largeFileProblem, leftoverProblem, leftoverStorage, waitForEnd } from './large-stream.ts';

// The low-disk check, the same in Firefox and Chrome: the room the browser gives the extension is cut to
// a fraction of the stream (a disk that fills up is the same failure from the extension's side, and a
// real one would need 300 GB written first), the download must end with the words for a full disk and
// leave nothing behind, and after the room is back "Try again" must save the whole file. It runs when
// SMOKE_LOW_DISK=1 is set, on the 1.1 GiB stream of `/large.html`.

/** Room for the first segments of the stream and not for its 1.1 GiB. */
export const LOW_ROOM_BYTES = 256 * 1024 * 1024;

const FULL_DISK_TEXT = `${FAILED_TEXT} ${DISK_FULL}`;
const RETRY_WAIT_MS = 30_000;
const POLL_MS = 500;

/** What each browser does to cut the room of the extension and to give it back. */
export interface RoomLimit {
  /** Lets the extension store at most `bytes`; false when the browser would not. */
  cut(bytes: number): Promise<boolean>;
  /** Gives the room back; false when the browser would not. */
  restore(): Promise<boolean>;
}

export function lowDiskEnabled(): boolean {
  return process.env['SMOKE_LOW_DISK'] === '1';
}

/** Waits until the card no longer shows the text of the failure it had, that is until "Try again" has started a new job. */
async function waitForNewJob(popup: PopupPage, resultText: string): Promise<boolean> {
  const deadline = Date.now() + RETRY_WAIT_MS;
  while (Date.now() < deadline) {
    if ((await popup.read(resultText)) !== FULL_DISK_TEXT) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

const RESULT_SCRIPT = "(() => { const line = document.querySelector('#media-list .job .result'); return line ? line.textContent : ''; })()";
const RETRY_VISIBLE_SCRIPT = "(() => { const button = document.querySelector('#media-list .job .retry'); return button !== null && !button.hidden ? 'yes' : 'no'; })()";

/** The job that starts with the room cut: it must end in the words for a full disk, save nothing and leave no temporary files. */
async function failForWantOfRoom(popup: PopupPage, savedFile: string, storageUsage: () => Promise<number | undefined>): Promise<string[]> {
  const problems: string[] = [];
  await popup.act("document.querySelector('#media-list .download').click();");
  const end = await waitForEnd(popup);
  if (end !== FULL_DISK_TEXT) {
    problems.push(`with room for ${LOW_ROOM_BYTES / 1024 / 1024} MiB the job did not end as "${FULL_DISK_TEXT}": ${end}`);
  }
  if (existsSync(savedFile)) {
    problems.push('a file was saved although the job failed');
  }
  const leftText = leftoverProblem(await leftoverStorage(storageUsage));
  if (leftText !== undefined) {
    problems.push(`after the full-disk failure: ${leftText}`);
  }
  if ((await popup.read(RETRY_VISIBLE_SCRIPT)) !== 'yes') {
    problems.push('the failed job did not offer "Try again"');
  }
  return problems;
}

/** "Try again" with the room back: the whole stream is saved, intact, and no temporary files are left. */
async function retryWithRoom(popup: PopupPage, savedFile: string, storageUsage: () => Promise<number | undefined>): Promise<string[]> {
  await popup.act("document.querySelector('#media-list .job .retry').click();");
  if (!(await waitForNewJob(popup, RESULT_SCRIPT))) {
    return ['"Try again" did not start a new job'];
  }

  const retried = await waitForEnd(popup);
  if (retried !== SAVED_TEXT) {
    return [`with the room back, "Try again" did not end as "${SAVED_TEXT}": ${retried}`];
  }

  const problems: string[] = [];
  const fileText = largeFileProblem(savedFile, LARGE_CHECK);
  if (fileText !== undefined) {
    problems.push(`after "Try again": ${fileText}`);
  }
  const leftText = leftoverProblem(await leftoverStorage(storageUsage));
  if (leftText !== undefined) {
    problems.push(`after "Try again": ${leftText}`);
  }
  return problems;
}

/**
 * With the room cut, the download of the large stream must fail with the full-disk words, leave no
 * temporary files and save nothing; with the room back, "Try again" must save the file. Logs one line
 * (with the `label` of the browser) and returns what went wrong.
 */
export async function checkLowDisk(label: string, popup: PopupPage, savedFile: string, storageUsage: () => Promise<number | undefined>, room: RoomLimit): Promise<string[]> {
  // A copy of the file from an earlier check would make the browser name the new one "(1)".
  rmSync(savedFile, { force: true });
  if (!(await room.cut(LOW_ROOM_BYTES))) {
    return [`${label} would not cut the room of the extension, so the low-disk case could not be tried`];
  }

  let problems: string[];
  try {
    problems = await failForWantOfRoom(popup, savedFile, storageUsage);
  } catch (error) {
    // The room goes back whatever happened, so the checks after this one are not run on a cut one.
    await room.restore();
    throw error;
  }

  if (!(await room.restore())) {
    problems.push(`${label} would not give the room back, so the retry could not be tried`);
    return problems;
  }

  problems.push(...(await retryWithRoom(popup, savedFile, storageUsage)));
  rmSync(savedFile, { force: true });

  if (problems.length > 0) {
    return problems;
  }
  console.log(`${label} runtime: low disk: with room for ${LOW_ROOM_BYTES / 1024 / 1024} MiB the job ended with the full-disk words, saved nothing and left no temporary files; with the room back "Try again" saved the whole stream`);
  return problems;
}
