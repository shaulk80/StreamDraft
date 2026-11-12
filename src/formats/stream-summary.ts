import type { StreamDetails, StreamVariant } from '../core/media.ts';
import { fail, ok, type Result } from '../core/result.ts';
import { collectParts } from '../core/stream-parts.ts';
import { buildQualityOptions } from '../core/streams.ts';
import type { DashManifest } from './dash-types.ts';
import type { HlsMasterPlaylist, HlsMediaPlaylist, HlsPlaylist } from './hls-types.ts';

const LIVE_UNSUPPORTED = 'Live streams cannot be downloaded yet.';

/** Only what the quality list and the engine need to find a rendition again; segment lists stay out of the storage. */
function plainVariant(variant: StreamVariant): StreamVariant {
  return {
    variantId: variant.variantId,
    bandwidth: variant.bandwidth,
    width: variant.width,
    height: variant.height,
    codecs: variant.codecs,
    frameRate: variant.frameRate,
    audioOnly: variant.audioOnly,
  };
}

function protectedDetails(reason: string, segmentUrls: readonly string[] = []): StreamDetails {
  return { qualities: [], protected: true, protectedReason: reason, ...collectParts(segmentUrls) };
}

function summarizeHlsMaster(master: HlsMasterPlaylist): Result<StreamDetails> {
  if (master.protectedReason !== undefined) {
    return ok(protectedDetails(master.protectedReason));
  }
  if (master.variants.length === 0) {
    return fail('The playlist lists no video.');
  }

  const renditionUrls = master.audioRenditions.flatMap((rendition) => (rendition.url === undefined ? [] : [rendition.url]));
  return ok({
    qualities: buildQualityOptions(master.variants.map(plainVariant)),
    protected: false,
    partUrls: [...master.variants.map((variant) => variant.variantId), ...renditionUrls],
  });
}

function summarizeHlsMedia(media: HlsMediaPlaylist): Result<StreamDetails> {
  if (media.protectedReason !== undefined) {
    return ok(protectedDetails(media.protectedReason));
  }
  if (media.live) {
    return fail(LIVE_UNSUPPORTED);
  }

  // A playlist on its own is one rendition: itself.
  const segmentUrls = media.segments.flatMap((segment) => (segment.init === undefined ? [segment.url] : [segment.url, segment.init.url]));
  return ok({
    qualities: buildQualityOptions([{ variantId: media.url }], media.totalDurationSeconds),
    protected: false,
    ...collectParts(segmentUrls),
  });
}

/** The quality list (or the protection) an HLS playlist gives its item. */
export function summarizeHls(playlist: HlsPlaylist): Result<StreamDetails> {
  return playlist.kind === 'master' ? summarizeHlsMaster(playlist) : summarizeHlsMedia(playlist);
}

/**
 * The quality list (or the protection) a DASH manifest gives its item. Sizes
 * come from the bit rate and the length; they cover the picture only, the
 * sound is a separate representation.
 */
export function summarizeDash(manifest: DashManifest): Result<StreamDetails> {
  if (manifest.protectedReason !== undefined) {
    return ok(protectedDetails(manifest.protectedReason, manifest.segmentUrls));
  }
  if (manifest.live) {
    return fail(LIVE_UNSUPPORTED);
  }

  const variants = [...manifest.video, ...manifest.audio].map(plainVariant);
  const qualities = buildQualityOptions(variants, manifest.durationSeconds);
  if (qualities.length === 0) {
    return fail('The manifest lists no video or audio.');
  }
  return ok({ qualities, protected: false, ...collectParts(manifest.segmentUrls) });
}
