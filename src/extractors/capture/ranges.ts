import type { TimeRange } from './types.ts';

/** Segments of one stream follow each other with at most this much between them (seconds): rounding of the clock, not a hole. */
export const ADJACENT_SECONDS = 0.1;
/** Two segments that start this close to each other are the same segment. */
export const SAME_START_SECONDS = 0.02;
/** The video counts as covered from its start and to its end within this much (seconds). */
export const EDGE_SECONDS = 0.5;

/** The ranges, sorted, with those that touch or lie within `tolerance` of each other joined. */
export function mergeRanges(ranges: readonly TimeRange[], tolerance: number = ADJACENT_SECONDS): TimeRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end + tolerance) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

export function totalSeconds(ranges: readonly TimeRange[]): number {
  return ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
}

/**
 * The stretches of 0 to `duration` that `covered` leaves open. The first and
 * last half second are allowed to be missing (a stream rarely starts and ends
 * exactly on the video's boundaries).
 */
export function gapsIn(covered: readonly TimeRange[], duration: number): TimeRange[] {
  const gaps: TimeRange[] = [];
  let cursor = 0;
  for (const range of mergeRanges(covered)) {
    if (range.start - cursor > EDGE_SECONDS) {
      gaps.push({ start: cursor, end: range.start });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (duration - cursor > EDGE_SECONDS) {
    gaps.push({ start: cursor, end: duration });
  }
  return gaps;
}

/** `m:ss`, or `h:mm:ss` from an hour on; a stretch of the video as a person says it. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`;
  }
  return `${minutes}:${rest}`;
}
