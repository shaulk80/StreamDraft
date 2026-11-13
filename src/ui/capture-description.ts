import { formatClock } from '../extractors/capture/ranges.ts';
import type { CaptureSnapshot, TimeRange } from '../extractors/capture/types.ts';

export type CapturePhase =
  /** Nothing is being recorded: the Record button is offered. */
  | 'idle'
  /** The tab was armed; the player has not appended anything yet. */
  | 'waiting'
  | 'recording'
  /** The whole video is recorded and can be saved. */
  | 'ready'
  /** The recording cannot go on or cannot be saved; the text says why. */
  | 'problem';

/** What the popup shows of a recording: words, how far it is, and what the user can do. */
export interface CaptureDescription {
  phase: CapturePhase;
  text: string;
  /** 0 to 1 by covered time; undefined when the length of the video is not known yet. */
  fraction: number | undefined;
  canSave: boolean;
  /** An extra line, such as a skipped part that has to be played again. */
  note?: string;
}

const MAX_SHOWN_GAPS = 3;
const NO_BUFFERS = 'The video has not started yet. Press play if it does not start by itself.';
const PROTECTED = 'This video is protected. StreamDraft does not record protected videos.';

/** The shortest covered time of any buffer: the video is only as whole as its weakest track. */
function coveredSeconds(snapshot: CaptureSnapshot): number {
  return Math.min(...snapshot.buffers.map((buffer) => buffer.coveredSeconds));
}

function lastCoveredEnd(snapshot: CaptureSnapshot): number {
  return Math.max(0, ...snapshot.buffers.flatMap((buffer) => buffer.covered.map((range) => range.end)));
}

/** A stretch that no buffer holds although the recording goes on after it: the viewer skipped it. */
function skippedParts(snapshot: CaptureSnapshot): TimeRange[] {
  const reached = lastCoveredEnd(snapshot);
  return snapshot.missing.filter((range) => range.end < reached);
}

function skippedNote(skipped: readonly TimeRange[]): string | undefined {
  if (skipped.length === 0) {
    return undefined;
  }

  const shown = skipped.slice(0, MAX_SHOWN_GAPS).map((range) => `${formatClock(range.start)} to ${formatClock(range.end)}`);
  const more = skipped.length > shown.length ? ' and more' : '';
  return `Parts of the video were skipped (${shown.join(', ')}${more}). Go back to them and let them play.`;
}

function describeProgress(snapshot: CaptureSnapshot, duration: number | undefined): CaptureDescription {
  const covered = coveredSeconds(snapshot);
  const note = skippedNote(skippedParts(snapshot));
  if (duration === undefined || duration <= 0) {
    return { phase: 'recording', text: `Recording: ${formatClock(covered)} so far.`, fraction: undefined, canSave: false, note };
  }

  const fraction = Math.min(1, covered / duration);
  return { phase: 'recording', text: `Recording: ${formatClock(covered)} of ${formatClock(duration)}.`, fraction, canSave: false, note };
}

/** The text and progress for what the page's recording holds. `undefined` means the page has no recording. */
export function describeCapture(snapshot: CaptureSnapshot | undefined): CaptureDescription {
  if (snapshot === undefined) {
    return { phase: 'idle', text: '', fraction: undefined, canSave: false };
  }
  if (snapshot.protected) {
    return { phase: 'problem', text: snapshot.problems[0] ?? PROTECTED, fraction: undefined, canSave: false };
  }
  if (snapshot.buffers.length === 0) {
    return { phase: 'waiting', text: NO_BUFFERS, fraction: undefined, canSave: false };
  }

  const stopped = snapshot.buffers.find((buffer) => buffer.stoppedBecause !== undefined);
  if (stopped?.stoppedBecause !== undefined) {
    return { phase: 'problem', text: `${stopped.stoppedBecause} Press Record to start again.`, fraction: undefined, canSave: false };
  }

  if (snapshot.complete) {
    const length = snapshot.durationSeconds === undefined ? '' : ` (${formatClock(snapshot.durationSeconds)})`;
    return { phase: 'ready', text: `The whole video is recorded${length}.`, fraction: 1, canSave: true };
  }
  return describeProgress(snapshot, snapshot.durationSeconds);
}
