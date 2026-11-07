import { fail, ok, type Result } from '../core/result.ts';
import { parseKeyTag } from './hls-key.ts';
import { parseAttributeList, parseByteRange, parsePositiveNumber, parseTag, type TagLine } from './hls-lines.ts';
import type { HlsByteRange, HlsInitSection, HlsKey, HlsMediaPlaylist, HlsSegment } from './hls-types.ts';
import { resolveUrl } from './resolve-url.ts';

/** What the lines before a segment address say about that segment. */
interface PendingSegment {
  durationSeconds?: number;
  byteRangeText?: string;
  discontinuity: boolean;
}

/**
 * Reads a media playlist (a list of segments) line by line. One instance reads
 * one playlist. Expected problems come back as `fail`, never as an exception.
 */
export class MediaPlaylistParser {
  private readonly segments: HlsSegment[] = [];
  private pending: PendingSegment = { discontinuity: false };
  private key: HlsKey | undefined;
  private init: HlsInitSection | undefined;
  private lastRange: { url: string; end: number } | undefined;
  private mediaSequence = 0;
  private targetDurationSeconds: number | undefined;
  private ended = false;
  private isVod = false;
  private protectedReason: string | undefined;

  constructor(private readonly playlistUrl: string) {}

  parse(lines: string[]): Result<HlsMediaPlaylist> {
    for (const line of lines) {
      const outcome = this.readLine(line);
      if (!outcome.ok) {
        return outcome;
      }
      if (this.protectedReason !== undefined) {
        return ok(this.build());
      }
    }

    if (this.segments.length === 0) {
      return fail('The playlist lists no segments.');
    }
    return ok(this.build());
  }

  private build(): HlsMediaPlaylist {
    const segments = this.protectedReason === undefined ? this.segments : [];
    const totalDurationSeconds = segments.reduce((total, segment) => total + segment.durationSeconds, 0);
    return {
      kind: 'media',
      url: this.playlistUrl,
      segments,
      targetDurationSeconds: this.targetDurationSeconds,
      totalDurationSeconds,
      live: !this.ended && !this.isVod,
      protectedReason: this.protectedReason,
    };
  }

  private readLine(line: string): Result<void> {
    const tag = parseTag(line);
    if (tag) {
      return this.readTag(tag);
    }
    if (line.startsWith('#')) {
      return ok(undefined);
    }
    return this.addSegment(line);
  }

  private readTag(tag: TagLine): Result<void> {
    switch (tag.name) {
      case '#EXTINF':
        return this.readDuration(tag.value);
      case '#EXT-X-BYTERANGE':
        this.pending.byteRangeText = tag.value;
        return ok(undefined);
      case '#EXT-X-DISCONTINUITY':
        this.pending.discontinuity = true;
        return ok(undefined);
      case '#EXT-X-KEY':
        return this.readKey(tag.value);
      case '#EXT-X-MAP':
        return this.readMap(tag.value);
      case '#EXT-X-TARGETDURATION':
        this.targetDurationSeconds = parsePositiveNumber(tag.value);
        return ok(undefined);
      case '#EXT-X-MEDIA-SEQUENCE':
        this.mediaSequence = Number(tag.value) || 0;
        return ok(undefined);
      case '#EXT-X-PLAYLIST-TYPE':
        this.isVod = tag.value.trim() === 'VOD';
        return ok(undefined);
      case '#EXT-X-ENDLIST':
        this.ended = true;
        return ok(undefined);
      case '#EXT-X-I-FRAMES-ONLY':
        return fail('Playlists of key frames only cannot be downloaded.');
      default:
        return ok(undefined);
    }
  }

  private readDuration(value: string): Result<void> {
    const duration = Number(value.split(',')[0]);
    if (!Number.isFinite(duration) || duration < 0) {
      return fail(`Bad segment length: ${value}`);
    }
    this.pending.durationSeconds = duration;
    return ok(undefined);
  }

  private readKey(value: string): Result<void> {
    const outcome = parseKeyTag(value, this.playlistUrl);
    if (!outcome.ok) {
      return outcome;
    }

    const parsed = outcome.value;
    if (parsed.kind === 'protected') {
      this.protectedReason = parsed.reason;
      return ok(undefined);
    }
    this.key = parsed.kind === 'aes' ? parsed.key : undefined;
    return ok(undefined);
  }

  private readMap(value: string): Result<void> {
    const attributes = parseAttributeList(value);
    const reference = attributes.get('URI');
    const url = reference === undefined ? undefined : resolveUrl(reference, this.playlistUrl);
    if (url === undefined) {
      return fail(`Bad initialisation section address: ${reference ?? '(none)'}`);
    }

    const rangeText = attributes.get('BYTERANGE');
    if (rangeText === undefined) {
      this.init = { url };
      return ok(undefined);
    }

    const range = parseByteRange(rangeText, 0);
    if (!range.ok) {
      return range;
    }
    this.init = { url, byteRange: range.value };
    return ok(undefined);
  }

  private addSegment(reference: string): Result<void> {
    const url = resolveUrl(reference, this.playlistUrl);
    if (url === undefined) {
      return fail(`Bad segment address: ${reference}`);
    }

    const { durationSeconds, byteRangeText, discontinuity } = this.pending;
    if (durationSeconds === undefined) {
      return fail(`The segment ${reference} has no length.`);
    }

    const byteRange = this.placeByteRange(url, byteRangeText);
    if (byteRange && !byteRange.ok) {
      return byteRange;
    }

    this.segments.push({
      sequence: this.mediaSequence + this.segments.length,
      url,
      durationSeconds,
      byteRange: byteRange?.value,
      key: this.key,
      init: this.init,
      discontinuity,
    });
    this.pending = { discontinuity: false };
    return ok(undefined);
  }

  /** The byte range of a segment, or undefined when it is the whole resource. Remembers where it ended. */
  private placeByteRange(url: string, text: string | undefined): Result<HlsByteRange> | undefined {
    if (text === undefined) {
      this.lastRange = undefined;
      return undefined;
    }

    const continuesFrom = this.lastRange?.url === url ? this.lastRange.end : undefined;
    const range = parseByteRange(text, continuesFrom);
    if (range.ok) {
      this.lastRange = { url, end: range.value.offset + range.value.length };
    }
    return range;
  }
}
