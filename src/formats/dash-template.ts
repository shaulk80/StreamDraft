import { fail, ok, type Result } from '../core/result.ts';
import type { DashSegment } from './dash-types.ts';
import { expandTemplate, parseNumberAttribute } from './dash-values.ts';
import { resolveUrl } from './resolve-url.ts';
import { childNamed, childrenNamed, type XmlElement } from './xml.ts';

/** More segments than this is a broken or hostile manifest (a 10-hour film in 2 s pieces has 18000). */
export const MAX_SEGMENTS = 200_000;

export interface SegmentContext {
  /** The address relative addresses of the representation are resolved against. */
  baseUrl: string;
  representationId: string;
  bandwidth?: number;
  /** Length of the period in seconds, when the manifest states it. */
  periodDurationSeconds?: number;
}

export interface SegmentPlan {
  init?: DashSegment;
  segments: DashSegment[];
}

/** One entry of a segment timeline, in timescale ticks. */
interface TimelineEntry {
  time: number;
  duration: number;
}

const DEFAULT_START_NUMBER = 1;

function templateValues(context: SegmentContext): Record<string, string | number> {
  const values: Record<string, string | number> = { RepresentationID: context.representationId };
  if (context.bandwidth !== undefined) {
    values.Bandwidth = context.bandwidth;
  }
  return values;
}

/** Entries of a `SegmentTimeline`; a repeat count of -1 runs to the end of the period (`endTicks`). */
function timelineEntries(timeline: XmlElement, endTicks: number | undefined): Result<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];
  let cursor = 0;

  for (const entry of childrenNamed(timeline, 'S')) {
    const duration = parseNumberAttribute(entry.attributes.get('d'), 1);
    if (duration === undefined) {
      return fail('A segment in the timeline has no valid length.');
    }

    let time = parseNumberAttribute(entry.attributes.get('t')) ?? cursor;
    const repeat = Number(entry.attributes.get('r') ?? 0);
    const open = repeat < 0;
    if (open && endTicks === undefined) {
      return fail('The timeline repeats to the end of the period, but the period has no length.');
    }

    const target = open ? Math.ceil(((endTicks ?? 0) - time) / duration) : repeat + 1;
    for (let index = 0; index < Math.max(target, 1); index += 1) {
      if (entries.length >= MAX_SEGMENTS) {
        return fail('The manifest lists too many segments.');
      }
      entries.push({ time, duration });
      time += duration;
    }
    cursor = time;
  }
  return ok(entries);
}

/** Equal pieces of `duration` ticks that cover the period; the last one may be shorter. */
function evenEntries(duration: number, totalTicks: number): Result<TimelineEntry[]> {
  const count = Math.ceil(totalTicks / duration);
  if (count > MAX_SEGMENTS) {
    return fail('The manifest lists too many segments.');
  }

  const entries: TimelineEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = index * duration;
    entries.push({ time, duration: Math.min(duration, totalTicks - time) });
  }
  return ok(entries);
}

function entriesOf(template: XmlElement, timescale: number, context: SegmentContext): Result<TimelineEntry[]> {
  const endTicks = context.periodDurationSeconds === undefined ? undefined : context.periodDurationSeconds * timescale;
  const timeline = childNamed(template, 'SegmentTimeline');
  if (timeline) {
    return timelineEntries(timeline, endTicks);
  }

  const duration = parseNumberAttribute(template.attributes.get('duration'), 1);
  if (duration === undefined) {
    return fail('The segment template has neither a timeline nor a segment length.');
  }
  if (endTicks === undefined) {
    return fail('The manifest does not say how long the video is, so its segments cannot be counted.');
  }
  return evenEntries(duration, endTicks);
}

function initSegment(template: XmlElement, context: SegmentContext): Result<DashSegment | undefined> {
  const pattern = template.attributes.get('initialization');
  if (pattern === undefined) {
    return ok(undefined);
  }

  const expanded = expandTemplate(pattern, templateValues(context));
  const url = expanded === undefined ? undefined : resolveUrl(expanded, context.baseUrl);
  if (url === undefined) {
    return fail(`Bad initialisation address: ${pattern}`);
  }
  return ok({ url });
}

/** Segments from a `SegmentTemplate` with `$Number$` or `$Time$` addresses, a timeline or a fixed length. */
export function planTemplateSegments(template: XmlElement, context: SegmentContext): Result<SegmentPlan> {
  const pattern = template.attributes.get('media');
  if (pattern === undefined) {
    return fail('The segment template has no address pattern.');
  }

  const timescale = parseNumberAttribute(template.attributes.get('timescale'), 1) ?? 1;
  const entries = entriesOf(template, timescale, context);
  if (!entries.ok) {
    return entries;
  }

  const init = initSegment(template, context);
  if (!init.ok) {
    return init;
  }

  const startNumber = parseNumberAttribute(template.attributes.get('startNumber')) ?? DEFAULT_START_NUMBER;
  const endNumber = parseNumberAttribute(template.attributes.get('endNumber'));
  const segments: DashSegment[] = [];
  for (const [index, entry] of entries.value.entries()) {
    const number = startNumber + index;
    if (endNumber !== undefined && number > endNumber) {
      break;
    }

    const expanded = expandTemplate(pattern, { ...templateValues(context), Number: number, Time: entry.time });
    const url = expanded === undefined ? undefined : resolveUrl(expanded, context.baseUrl);
    if (url === undefined) {
      return fail(`Bad segment address pattern: ${pattern}`);
    }
    segments.push({ url, durationSeconds: entry.duration / timescale });
  }
  return ok({ init: init.value, segments });
}
