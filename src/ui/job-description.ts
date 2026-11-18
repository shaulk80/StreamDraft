import { formatSize } from '../core/media.ts';
import { isRetryable } from '../core/failures.ts';
import type { JobState } from '../engine/job-state.ts';

/** What the popup shows of a stream job: words, how far it is, and what the user can still do. */
export interface JobDescription {
  text: string;
  /** 0 to 1; undefined when the length of the job is not known yet. */
  fraction: number | undefined;
  /** True once the job ended, however it ended. */
  finished: boolean;
  failed: boolean;
  canCancel: boolean;
  /** True for a failure that a new try can fix. */
  canRetry: boolean;
}

const PERCENT = 100;

/** The parts of a description that are the same until a job has ended. */
const UNFINISHED = { finished: false, failed: false, canRetry: false } as const;
const ENDED = { finished: true, failed: false, canCancel: false, canRetry: false } as const;

/** Shown from the moment the background took the job until its first saved state arrives. */
export const STARTING: JobDescription = { text: 'Starting...', fraction: undefined, canCancel: true, ...UNFINISHED };

function fetchingText(state: JobState, fraction: number): string {
  const percent = Math.floor(fraction * PERCENT);
  const size = state.bytes > 0 ? ` (${formatSize(state.bytes)})` : '';
  return `Downloading: ${percent}%${size}`;
}

function describeRunning(state: JobState): JobDescription {
  if (state.totalSegments === 0) {
    return STARTING;
  }

  if (state.doneSegments < state.totalSegments) {
    const fraction = state.doneSegments / state.totalSegments;
    return { text: fetchingText(state, fraction), fraction, canCancel: true, ...UNFINISHED };
  }

  // Joining the parts and handing the file to the browser cannot be stopped from here.
  return { text: 'Joining the parts and saving...', fraction: undefined, canCancel: false, ...UNFINISHED };
}

function describeFailure(state: JobState): JobDescription {
  const reason = state.error === undefined ? '' : ` ${state.error}`;
  return {
    text: `Could not save the video.${reason}`,
    fraction: undefined,
    finished: true,
    failed: true,
    canCancel: false,
    canRetry: isRetryable(state.error),
  };
}

/** The text and progress for the saved state of a job. */
export function describeJob(state: JobState): JobDescription {
  switch (state.status) {
    case 'running':
      return describeRunning(state);
    case 'done':
      return { text: 'Saved to your downloads folder.', fraction: 1, ...ENDED };
    case 'cancelled':
      return { text: 'Cancelled.', fraction: undefined, ...ENDED };
    case 'failed':
      return describeFailure(state);
  }
}
