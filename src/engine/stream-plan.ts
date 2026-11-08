import type { MediaItem, QualityOption, StreamVariant } from '../core/media.ts';
import { fail, ok, type Result } from '../core/result.ts';
import type { FetchText } from '../detect/manifest-fetch.ts';
import { planDash } from './dash-plan.ts';
import type { MuxSource, StoredPart } from './fragment-sources.ts';
import { planHls } from './hls-plan.ts';
import { AUDIO_EXTRACTION_MISSING, NO_VARIANT, PROTECTED, type PlannedSource } from './plan-types.ts';
import { segmentName } from './segment-job.ts';
import type { SegmentRequest } from './segment-fetcher.ts';

/**
 * Everything the engine needs to download one video in one quality: the flat
 * list of addresses to fetch (`requests[i]` is stored as `segmentName(i)`) and
 * the streams to join from what was stored.
 */
export interface StreamPlan {
  requests: SegmentRequest[];
  sources: MuxSource[];
  /** Some part is AES-128 encrypted, so the muxer needs a decryptor. */
  encrypted: boolean;
}

/** Gives every part of the sources its store name, in the order they are fetched. */
export function assemblePlan(sources: readonly PlannedSource[]): StreamPlan {
  const requests: SegmentRequest[] = [];
  let encrypted = false;

  function add(request: SegmentRequest): StoredPart {
    requests.push(request);
    return { name: segmentName(requests.length - 1) };
  }

  const joined = sources.map((source): MuxSource => {
    const init = source.init === undefined ? undefined : add(source.init);
    const segments = source.segments.map((segment): StoredPart => {
      encrypted ||= segment.key !== undefined;
      return { ...add(segment.request), key: segment.key, sequence: segment.sequence };
    });
    return { format: source.format, init, segments };
  });
  return { requests, sources: joined, encrypted };
}

/**
 * Reads the stream's manifest again (the item holds only the summary) and
 * plans the download of the chosen quality. Nothing is fetched except
 * playlists and manifests.
 */
export async function planStream(item: MediaItem, option: QualityOption, fetchText: FetchText): Promise<Result<StreamPlan>> {
  if (item.protected) {
    return fail(PROTECTED);
  }

  const { variant } = option;
  if (variant === undefined) {
    return fail(NO_VARIANT);
  }
  if (option.quality === 'audio' && variant.audioOnly !== true) {
    return fail(AUDIO_EXTRACTION_MISSING);
  }

  const sources = await planSources(item, variant, fetchText);
  return sources.ok ? ok(assemblePlan(sources.value)) : sources;
}

async function planSources(item: MediaItem, variant: StreamVariant, fetchText: FetchText): Promise<Result<PlannedSource[]>> {
  switch (item.kind) {
    case 'hls':
      return planHls(item.url, variant, fetchText);
    case 'dash':
      return planDash(item.url, variant, fetchText);
    case 'direct':
      return fail('This is not a stream.');
  }
}
