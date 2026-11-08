import type { StreamVariant } from '../core/media.ts';
import { fail, ok, type Result } from '../core/result.ts';
import type { FetchText } from '../detect/manifest-fetch.ts';
import { parseDashManifest } from '../formats/dash.ts';
import type { DashRepresentation, DashSegment } from '../formats/dash-types.ts';
import type { SegmentRequest } from './segment-fetcher.ts';
import { LIVE, NO_VARIANT, PROTECTED, type PlannedSource } from './plan-types.ts';

const NO_PARTS = 'The manifest lists no parts of the video.';
const PLAIN_FILE = 'This stream is a single plain file without a segment index, which StreamDraft cannot join yet.';

function requestOf(segment: DashSegment): SegmentRequest {
  return segment.byteRange === undefined ? { url: segment.url } : { url: segment.url, byteRange: segment.byteRange };
}

function sourceOf(representation: DashRepresentation): Result<PlannedSource> {
  if (representation.init === undefined) {
    return fail(PLAIN_FILE);
  }
  if (representation.segments.length === 0) {
    return fail(NO_PARTS);
  }

  return ok({
    format: 'fmp4',
    init: requestOf(representation.init),
    segments: representation.segments.map((segment) => ({ request: requestOf(segment) })),
  });
}

/** The sound to join with a picture: the richest audio representation of the manifest. */
function bestAudio(audio: readonly DashRepresentation[]): DashRepresentation | undefined {
  return audio.reduce<DashRepresentation | undefined>(
    (best, candidate) => (best === undefined || (candidate.bandwidth ?? 0) > (best.bandwidth ?? 0) ? candidate : best),
    undefined,
  );
}

/**
 * Plans the download of one DASH representation. A picture is joined with the
 * best audio representation; an audio representation stands on its own.
 */
export async function planDash(url: string, wanted: StreamVariant, fetchText: FetchText): Promise<Result<PlannedSource[]>> {
  const fetched = await fetchText(url);
  if (!fetched.ok) {
    return fetched;
  }

  const manifest = parseDashManifest(fetched.value.text, fetched.value.url);
  if (!manifest.ok) {
    return manifest;
  }
  if (manifest.value.protectedReason !== undefined) {
    return fail(PROTECTED);
  }
  if (manifest.value.live) {
    return fail(LIVE);
  }

  const chosen = [...manifest.value.video, ...manifest.value.audio].find((candidate) => candidate.variantId === wanted.variantId);
  if (chosen === undefined) {
    return fail(NO_VARIANT);
  }

  const picture = sourceOf(chosen);
  if (!picture.ok) {
    return picture;
  }

  const audio = chosen.audioOnly === true ? undefined : bestAudio(manifest.value.audio);
  if (audio === undefined) {
    return ok([picture.value]);
  }

  const sound = sourceOf(audio);
  return sound.ok ? ok([picture.value, sound.value]) : sound;
}
