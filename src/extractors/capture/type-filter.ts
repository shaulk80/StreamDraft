/**
 * Media types the player is told the browser cannot play, so that it takes
 * H.264 and AAC in fragmented MP4, which the engine can join (decision 0010).
 * The WebM container, VP8, VP9 and AV1 are hidden; the match is on the whole
 * type string, so `video/mp4; codecs=av01...` and `audio/webm` both fall under it.
 */
const HIDDEN_TYPES = /webm|vp0?[89]|av01|\bav1\b/i;

export function isHiddenMediaType(type: unknown): boolean {
  return typeof type === 'string' && HIDDEN_TYPES.test(type);
}

/** Types the recorder can read: fragmented MP4. */
export function isRecordableMediaType(type: string): boolean {
  return /^(video|audio)\/mp4\b/i.test(type.trim());
}

export function mediaKindOf(type: string): 'video' | 'audio' | 'unknown' {
  const lower = type.trim().toLowerCase();
  if (lower.startsWith('video/')) {
    return 'video';
  }
  if (lower.startsWith('audio/')) {
    return 'audio';
  }
  return 'unknown';
}
