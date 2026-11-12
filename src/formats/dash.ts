import { fail, ok, type Result } from '../core/result.ts';
import { protectionOf } from './dash-protection.ts';
import { planSegments } from './dash-segments.ts';
import type { DashManifest, DashRepresentation } from './dash-types.ts';
import { parseFrameRate, parseIsoDuration, parseNumberAttribute } from './dash-values.ts';
import { resolveUrl } from './resolve-url.ts';
import { childNamed, childrenNamed, parseXml, type XmlElement } from './xml.ts';

type TrackKind = 'video' | 'audio';

/** Where an adaptation set is read: its place in the manifest and the facts it inherits. */
interface SetScope {
  period: XmlElement;
  baseUrl: string;
  periodDurationSeconds: number | undefined;
}

/** What one adaptation set contributes. */
interface SetResult {
  kind: TrackKind | undefined;
  /** Empty for a protected set. */
  representations: DashRepresentation[];
  protectedReason?: string;
  segmentUrls: string[];
}

function segmentUrlsOf(representations: readonly DashRepresentation[]): string[] {
  return representations.flatMap((representation) => [
    ...(representation.init === undefined ? [] : [representation.init.url]),
    ...representation.segments.map((segment) => segment.url),
  ]);
}

/** The first value of an attribute along the chain (representation, adaptation set, period). */
function inherited(chain: XmlElement[], name: string): string | undefined {
  for (const element of chain) {
    const value = element.attributes.get(name);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** The address a `BaseURL` child of `element` gives, relative to `parent`; `parent` itself when there is none. */
function baseUrlOf(element: XmlElement, parent: string): Result<string> {
  const reference = childNamed(element, 'BaseURL')?.text.trim();
  if (reference === undefined || reference === '') {
    return ok(parent);
  }

  const url = resolveUrl(reference, parent);
  if (url === undefined) {
    return fail(`Bad BaseURL: ${reference}`);
  }
  return ok(url);
}

/** `video` or `audio` from the content type or the MIME type; undefined for subtitles, images and the rest. */
function kindOf(chain: XmlElement[]): TrackKind | undefined {
  const declared = inherited(chain, 'contentType') ?? inherited(chain, 'mimeType')?.split('/')[0];
  if (declared === 'video' || declared === 'audio') {
    return declared;
  }
  return undefined;
}

function buildRepresentation(
  representation: XmlElement,
  set: XmlElement,
  kind: TrackKind,
  scope: SetScope,
): Result<DashRepresentation> {
  const id = representation.attributes.get('id');
  if (id === undefined) {
    return fail('A representation has no id.');
  }

  const base = baseUrlOf(representation, scope.baseUrl);
  if (!base.ok) {
    return base;
  }

  const chain = [representation, set, scope.period];
  const bandwidth = parseNumberAttribute(inherited(chain, 'bandwidth'), 1);
  const plan = planSegments(chain, { baseUrl: base.value, representationId: id, bandwidth, periodDurationSeconds: scope.periodDurationSeconds });
  if (!plan.ok) {
    return fail(`Representation ${id}: ${plan.error}`);
  }

  return ok({
    variantId: id,
    bandwidth,
    width: kind === 'video' ? parseNumberAttribute(inherited(chain, 'width'), 1) : undefined,
    height: kind === 'video' ? parseNumberAttribute(inherited(chain, 'height'), 1) : undefined,
    codecs: inherited(chain, 'codecs'),
    frameRate: kind === 'video' ? parseFrameRate(inherited(chain, 'frameRate')) : undefined,
    audioOnly: kind === 'audio' ? true : undefined,
    mimeType: inherited(chain, 'mimeType'),
    language: inherited(chain, 'lang'),
    init: plan.value.init,
    segments: plan.value.segments,
  });
}

function readAdaptationSet(set: XmlElement, scope: SetScope): Result<SetResult> {
  const kind = kindOf([set, scope.period]);
  const representations = childrenNamed(set, 'Representation');
  if (kind === undefined) {
    return ok({ kind, representations: [], segmentUrls: [] });
  }

  const setBase = baseUrlOf(set, scope.baseUrl);
  if (!setBase.ok) {
    return setBase;
  }

  const setScope: SetScope = { ...scope, baseUrl: setBase.value };
  const built: DashRepresentation[] = [];
  let protectedReason: string | undefined;
  for (const representation of representations) {
    protectedReason ??= protectionOf([representation, set]);

    const result = buildRepresentation(representation, set, kind, setScope);
    if (result.ok) {
      built.push(result.value);
    } else if (protectedReason === undefined) {
      return result;
    }
  }

  // A protected set is not offered, but its segments are still the stream's own files.
  return ok({ kind, representations: protectedReason === undefined ? built : [], protectedReason, segmentUrls: segmentUrlsOf(built) });
}

function periodDurationOf(root: XmlElement, period: XmlElement): number | undefined {
  const own = parseIsoDuration(period.attributes.get('duration'));
  if (own !== undefined) {
    return own;
  }

  const total = parseIsoDuration(root.attributes.get('mediaPresentationDuration'));
  if (total === undefined) {
    return undefined;
  }
  return total - (parseIsoDuration(period.attributes.get('start')) ?? 0);
}

/**
 * Parses a DASH manifest (MPD). `manifestUrl` is the address the text was
 * fetched from; relative `BaseURL` and segment addresses resolve against it.
 * Supports one period with `SegmentTemplate` (number, time or timeline
 * addressing), `SegmentList`, `SegmentBase` and plain `BaseURL` files.
 * Content protection comes back as `protectedReason` with no representations.
 * Several periods, broken or unsupported input come back as an error with a
 * message for the popup.
 */
export function parseDashManifest(text: string, manifestUrl: string): Result<DashManifest> {
  if (!URL.canParse(manifestUrl)) {
    return fail(`Not a valid address: ${manifestUrl}`);
  }

  const document = parseXml(text);
  if (!document.ok) {
    return fail(`Not a DASH manifest: ${document.error}`);
  }

  const root = document.value;
  if (root.name !== 'MPD') {
    return fail('Not a DASH manifest.');
  }

  const periods = childrenNamed(root, 'Period');
  const period = periods[0];
  if (period === undefined) {
    return fail('The manifest has no period.');
  }
  if (periods.length > 1) {
    return fail('Streams with several periods (for example with ads) are not supported yet.');
  }

  return readPeriod(root, period, manifestUrl);
}

function readPeriod(root: XmlElement, period: XmlElement, manifestUrl: string): Result<DashManifest> {
  const rootBase = baseUrlOf(root, manifestUrl);
  if (!rootBase.ok) {
    return rootBase;
  }
  const periodBase = baseUrlOf(period, rootBase.value);
  if (!periodBase.ok) {
    return periodBase;
  }

  const scope: SetScope = { period, baseUrl: periodBase.value, periodDurationSeconds: periodDurationOf(root, period) };
  const video: DashRepresentation[] = [];
  const audio: DashRepresentation[] = [];
  const manifest: DashManifest = {
    url: manifestUrl,
    durationSeconds: parseIsoDuration(root.attributes.get('mediaPresentationDuration')) ?? scope.periodDurationSeconds,
    live: root.attributes.get('type') === 'dynamic',
    video,
    audio,
    segmentUrls: [],
  };

  let protectedReason: string | undefined;
  for (const set of childrenNamed(period, 'AdaptationSet')) {
    const result = readAdaptationSet(set, scope);
    if (!result.ok) {
      if (protectedReason === undefined) {
        return result;
      }
      continue;
    }

    protectedReason ??= result.value.protectedReason;
    manifest.segmentUrls.push(...result.value.segmentUrls);
    (result.value.kind === 'video' ? video : audio).push(...result.value.representations);
  }

  if (protectedReason !== undefined) {
    return ok({ ...manifest, video: [], audio: [], protectedReason });
  }
  if (video.length === 0 && audio.length === 0) {
    return fail('The manifest lists no video or audio.');
  }
  return ok(manifest);
}
