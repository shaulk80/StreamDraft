import { fail, ok, type Result } from '../core/result.ts';
import { MAX_SEGMENTS, planTemplateSegments, type SegmentContext, type SegmentPlan } from './dash-template.ts';
import type { DashByteRange, DashSegment } from './dash-types.ts';
import { parseNumberAttribute, parseRangeAttribute } from './dash-values.ts';
import { resolveUrl } from './resolve-url.ts';
import { childNamed, childrenNamed, type XmlElement } from './xml.ts';

export type { SegmentContext, SegmentPlan } from './dash-template.ts';

/** An `Initialization` element: its own address (or the representation's file) and a byte range. */
function readInitialization(element: XmlElement | undefined, context: SegmentContext): Result<DashSegment | undefined> {
  if (element === undefined) {
    return ok(undefined);
  }

  const reference = element.attributes.get('sourceURL');
  const url = reference === undefined ? context.baseUrl : resolveUrl(reference, context.baseUrl);
  if (url === undefined) {
    return fail(`Bad initialisation address: ${reference ?? ''}`);
  }
  return ok({ url, byteRange: parseRangeAttribute(element.attributes.get('range')) });
}

/** Segments listed one by one in a `SegmentList`. */
function planListSegments(list: XmlElement, context: SegmentContext): Result<SegmentPlan> {
  const init = readInitialization(childNamed(list, 'Initialization'), context);
  if (!init.ok) {
    return init;
  }

  const timescale = parseNumberAttribute(list.attributes.get('timescale'), 1) ?? 1;
  const duration = parseNumberAttribute(list.attributes.get('duration'), 1);
  const durationSeconds = duration === undefined ? undefined : duration / timescale;

  const entries = childrenNamed(list, 'SegmentURL');
  if (entries.length > MAX_SEGMENTS) {
    return fail('The manifest lists too many segments.');
  }

  const segments: DashSegment[] = [];
  for (const entry of entries) {
    const reference = entry.attributes.get('media');
    const url = reference === undefined ? context.baseUrl : resolveUrl(reference, context.baseUrl);
    if (url === undefined) {
      return fail(`Bad segment address: ${reference ?? ''}`);
    }
    segments.push({ url, byteRange: parseRangeAttribute(entry.attributes.get('mediaRange')), durationSeconds });
  }
  return ok({ init: init.value, segments });
}

/**
 * A representation that is one file with a segment index (`SegmentBase`, the
 * on-demand profile). The initialisation segment is the stated byte range;
 * the media runs from the end of the index (or of the initialisation segment)
 * to the end of the file.
 */
function planBaseSegments(base: XmlElement, context: SegmentContext): Result<SegmentPlan> {
  const init = readInitialization(childNamed(base, 'Initialization'), context);
  if (!init.ok) {
    return init;
  }

  const index = parseRangeAttribute(base.attributes.get('indexRange'));
  const mediaStart = mediaStartOf(index, init.value?.byteRange);
  const media: DashSegment = mediaStart > 0 ? { url: context.baseUrl, byteRange: { offset: mediaStart } } : { url: context.baseUrl };
  return ok({ init: init.value, segments: [media] });
}

/** Where the media of a one-file representation starts: after the index, else after the initialisation segment, else at 0. */
function mediaStartOf(index: DashByteRange | undefined, initRange: DashByteRange | undefined): number {
  if (index) {
    return index.offset + (index.length ?? 0);
  }
  if (initRange) {
    return initRange.offset + (initRange.length ?? 0);
  }
  return 0;
}

/**
 * Lists the segments of one representation. `chain` is the representation,
 * its adaptation set and its period, most specific first: the first one that
 * has a `SegmentTemplate`, `SegmentList` or `SegmentBase` decides. With none,
 * the representation is a plain file at its `BaseURL`.
 */
export function planSegments(chain: XmlElement[], context: SegmentContext): Result<SegmentPlan> {
  for (const element of chain) {
    const template = childNamed(element, 'SegmentTemplate');
    if (template) {
      return planTemplateSegments(template, context);
    }

    const list = childNamed(element, 'SegmentList');
    if (list) {
      return planListSegments(list, context);
    }

    const base = childNamed(element, 'SegmentBase');
    if (base) {
      return planBaseSegments(base, context);
    }
  }
  return ok({ segments: [{ url: context.baseUrl }] });
}
