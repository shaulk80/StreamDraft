import { fail, ok, type Result } from '../core/result.ts';
import { parseKeyTag } from './hls-key.ts';
import { parseAttributeList, parsePositiveNumber, parseResolution, parseTag, type AttributeMap } from './hls-lines.ts';
import type { HlsAudioRendition, HlsMasterPlaylist, HlsVariant } from './hls-types.ts';
import { resolveUrl } from './resolve-url.ts';

const AUDIO_CODEC_PREFIXES = ['mp4a', 'ac-3', 'ec-3', 'ac-4', 'opus', 'flac', 'alac', 'vorbis', 'mp3'];

function isAudioCodec(codec: string): boolean {
  const lower = codec.trim().toLowerCase();
  return AUDIO_CODEC_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** True only when the stream states codecs and every one of them is an audio codec. */
function hasOnlyAudioCodecs(codecs: string | undefined): boolean {
  if (codecs === undefined) {
    return false;
  }

  const list = codecs.split(',').filter((codec) => codec.trim().length > 0);
  return list.length > 0 && list.every(isAudioCodec);
}

/**
 * A variant from its `#EXT-X-STREAM-INF` attributes. The bit rate is the
 * average one when the playlist states it (it predicts the file size better
 * than the peak), otherwise the peak.
 */
function buildVariant(attributes: AttributeMap, variantId: string): HlsVariant {
  const resolution = parseResolution(attributes.get('RESOLUTION'));
  const codecs = attributes.get('CODECS');
  const variant: HlsVariant = {
    variantId,
    bandwidth: parsePositiveNumber(attributes.get('AVERAGE-BANDWIDTH')) ?? parsePositiveNumber(attributes.get('BANDWIDTH')),
    width: resolution?.width,
    height: resolution?.height,
    codecs,
    frameRate: parsePositiveNumber(attributes.get('FRAME-RATE')),
    audioGroupId: attributes.get('AUDIO'),
  };

  if (resolution === undefined && hasOnlyAudioCodecs(codecs)) {
    variant.audioOnly = true;
  }
  return variant;
}

function buildAudioRendition(attributes: AttributeMap, playlistUrl: string): HlsAudioRendition | undefined {
  const groupId = attributes.get('GROUP-ID');
  if (groupId === undefined) {
    return undefined;
  }

  const reference = attributes.get('URI');
  return {
    groupId,
    name: attributes.get('NAME') ?? groupId,
    language: attributes.get('LANGUAGE'),
    isDefault: attributes.get('DEFAULT') === 'YES',
    url: reference === undefined ? undefined : resolveUrl(reference, playlistUrl),
  };
}

/**
 * Reads a master playlist (a list of renditions). Variants that point to the
 * same media playlist (they differ only in the audio group) count once, the
 * first one wins. Key-frame-only playlists, subtitles and closed captions are
 * left out.
 */
export function parseMasterPlaylist(lines: string[], playlistUrl: string): Result<HlsMasterPlaylist> {
  const variants: HlsVariant[] = [];
  const audioRenditions: HlsAudioRendition[] = [];
  const seenAddresses = new Set<string>();
  let protectedReason: string | undefined;
  let waitingFor: AttributeMap | undefined;

  for (const line of lines) {
    const tag = parseTag(line);

    if (waitingFor !== undefined && tag === undefined && !line.startsWith('#')) {
      const variantId = resolveUrl(line, playlistUrl);
      if (variantId === undefined) {
        return fail(`Bad variant address: ${line}`);
      }
      if (!seenAddresses.has(variantId)) {
        seenAddresses.add(variantId);
        variants.push(buildVariant(waitingFor, variantId));
      }
      waitingFor = undefined;
      continue;
    }

    if (tag?.name === '#EXT-X-STREAM-INF') {
      waitingFor = parseAttributeList(tag.value);
    } else if (tag?.name === '#EXT-X-MEDIA') {
      const attributes = parseAttributeList(tag.value);
      const rendition = attributes.get('TYPE') === 'AUDIO' ? buildAudioRendition(attributes, playlistUrl) : undefined;
      if (rendition) {
        audioRenditions.push(rendition);
      }
    } else if (tag?.name === '#EXT-X-SESSION-KEY') {
      const outcome = parseKeyTag(tag.value, playlistUrl);
      if (outcome.ok && outcome.value.kind === 'protected') {
        protectedReason = outcome.value.reason;
      }
    }
  }

  if (variants.length === 0) {
    return fail('The playlist lists no renditions.');
  }
  return ok({ kind: 'master', url: playlistUrl, variants, audioRenditions, protectedReason });
}
