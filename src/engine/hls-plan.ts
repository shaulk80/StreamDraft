import type { StreamVariant } from '../core/media.ts';
import { fail, ok, type Result } from '../core/result.ts';
import type { FetchText } from '../detect/manifest-fetch.ts';
import { parseHlsPlaylist } from '../formats/hls.ts';
import type { HlsAudioRendition, HlsInitSection, HlsMasterPlaylist, HlsMediaPlaylist, HlsPlaylist, HlsVariant } from '../formats/hls-types.ts';
import type { SourceFormat } from './fragment-sources.ts';
import type { SegmentRequest } from './segment-fetcher.ts';
import { LIVE, NO_VARIANT, PROTECTED, type PlannedSource } from './plan-types.ts';

const NO_PARTS = 'The playlist lists no parts of the video.';
const CHANGING_INIT = 'The video changes its format in the middle, which StreamDraft cannot join.';
const ADTS_EXTENSIONS = ['.aac', '.adts'];

async function loadPlaylist(url: string, fetchText: FetchText): Promise<Result<HlsPlaylist>> {
  const fetched = await fetchText(url);
  if (!fetched.ok) {
    return fetched;
  }
  return parseHlsPlaylist(fetched.value.text, fetched.value.url);
}

async function loadMedia(url: string, fetchText: FetchText): Promise<Result<HlsMediaPlaylist>> {
  const playlist = await loadPlaylist(url, fetchText);
  if (!playlist.ok) {
    return playlist;
  }
  return playlist.value.kind === 'media' ? ok(playlist.value) : fail('The playlist of the quality is not a list of parts.');
}

function requestOf(url: string, byteRange: { offset: number; length: number } | undefined): SegmentRequest {
  return byteRange === undefined ? { url } : { url, byteRange };
}

function sameInit(left: HlsInitSection, right: HlsInitSection): boolean {
  return left.url === right.url && left.byteRange?.offset === right.byteRange?.offset && left.byteRange?.length === right.byteRange?.length;
}

function formatOf(media: HlsMediaPlaylist, hasInit: boolean): SourceFormat {
  if (hasInit) {
    return 'fmp4';
  }

  const [first] = media.segments;
  const path = first !== undefined && URL.canParse(first.url) ? new URL(first.url).pathname.toLowerCase() : '';
  return ADTS_EXTENSIONS.some((extension) => path.endsWith(extension)) ? 'adts' : 'ts';
}

/** The stream a media playlist describes: its init section (all segments must share one), its segments and their keys. */
function sourceOf(media: HlsMediaPlaylist): Result<PlannedSource> {
  if (media.protectedReason !== undefined) {
    return fail(PROTECTED);
  }
  if (media.live) {
    return fail(LIVE);
  }

  const [first] = media.segments;
  if (first === undefined) {
    return fail(NO_PARTS);
  }
  if (media.segments.some((segment) => (segment.init === undefined) !== (first.init === undefined))) {
    return fail(CHANGING_INIT);
  }
  const firstInit = first.init;
  if (firstInit !== undefined && media.segments.some((segment) => segment.init !== undefined && !sameInit(segment.init, firstInit))) {
    return fail(CHANGING_INIT);
  }

  return ok({
    format: formatOf(media, firstInit !== undefined),
    init: firstInit === undefined ? undefined : requestOf(firstInit.url, firstInit.byteRange),
    segments: media.segments.map((segment) => ({
      request: requestOf(segment.url, segment.byteRange),
      key: segment.key,
      sequence: segment.sequence,
    })),
  });
}

/** The sound track a variant names: its group's default rendition that has a playlist of its own. */
function audioRenditionOf(master: HlsMasterPlaylist, variant: HlsVariant): HlsAudioRendition | undefined {
  if (variant.audioGroupId === undefined) {
    return undefined;
  }

  const group = master.audioRenditions.filter((rendition) => rendition.groupId === variant.audioGroupId && rendition.url !== undefined);
  return group.find((rendition) => rendition.isDefault) ?? group[0];
}

async function planMaster(master: HlsMasterPlaylist, wanted: StreamVariant, fetchText: FetchText): Promise<Result<PlannedSource[]>> {
  if (master.protectedReason !== undefined) {
    return fail(PROTECTED);
  }

  const variant = master.variants.find((candidate) => candidate.variantId === wanted.variantId);
  if (variant === undefined) {
    return fail(NO_VARIANT);
  }

  const media = await loadMedia(variant.variantId, fetchText);
  if (!media.ok) {
    return media;
  }
  const picture = sourceOf(media.value);
  if (!picture.ok) {
    return picture;
  }

  const rendition = audioRenditionOf(master, variant);
  if (rendition?.url === undefined) {
    return ok([picture.value]);
  }

  const soundMedia = await loadMedia(rendition.url, fetchText);
  const sound = soundMedia.ok ? sourceOf(soundMedia.value) : soundMedia;
  return sound.ok ? ok([picture.value, sound.value]) : sound;
}

/**
 * Plans the download of one HLS rendition: the picture (with its sound inside
 * the segments, or as a separate rendition of the master playlist).
 */
export async function planHls(url: string, wanted: StreamVariant, fetchText: FetchText): Promise<Result<PlannedSource[]>> {
  const playlist = await loadPlaylist(url, fetchText);
  if (!playlist.ok) {
    return playlist;
  }

  if (playlist.value.kind === 'master') {
    return planMaster(playlist.value, wanted, fetchText);
  }

  // A media playlist on its own is the only rendition.
  const source = sourceOf(playlist.value);
  return source.ok ? ok([source.value]) : source;
}
