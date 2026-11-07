/** What a downloadable file is: the extension it is saved with and whether it has no picture. */
export interface FileType {
  container: string;
  audioOnly: boolean;
}

export type DetectedType = { kind: 'direct'; file: FileType } | { kind: 'hls' } | { kind: 'dash' };

function video(container: string): FileType {
  return { container, audioOnly: false };
}

function audio(container: string): FileType {
  return { container, audioOnly: true };
}

const BY_CONTENT_TYPE: Readonly<Record<string, FileType>> = {
  'video/mp4': video('mp4'),
  'video/webm': video('webm'),
  'video/ogg': video('ogv'),
  'video/quicktime': video('mov'),
  'video/x-m4v': video('m4v'),
  'video/x-matroska': video('mkv'),
  'audio/mpeg': audio('mp3'),
  'audio/mp3': audio('mp3'),
  'audio/mp4': audio('m4a'),
  'audio/x-m4a': audio('m4a'),
  'audio/aac': audio('aac'),
  'audio/ogg': audio('ogg'),
  'audio/opus': audio('opus'),
  'audio/webm': audio('weba'),
  'audio/wav': audio('wav'),
  'audio/x-wav': audio('wav'),
  'audio/flac': audio('flac'),
};

/** Used when the server does not say what the file is (generic content type or none). */
const BY_EXTENSION: Readonly<Record<string, FileType>> = {
  mp4: video('mp4'),
  m4v: video('m4v'),
  webm: video('webm'),
  ogv: video('ogv'),
  mov: video('mov'),
  mkv: video('mkv'),
  mp3: audio('mp3'),
  m4a: audio('m4a'),
  aac: audio('aac'),
  ogg: audio('ogg'),
  opus: audio('opus'),
  weba: audio('weba'),
  wav: audio('wav'),
  flac: audio('flac'),
};

const HLS_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
];
const DASH_CONTENT_TYPES = ['application/dash+xml'];
const GENERIC_CONTENT_TYPES = ['', 'application/octet-stream', 'binary/octet-stream'];

/** Pieces of a stream: they are served as video/mp4 or video/mp2t but are not videos on their own. */
const SEGMENT_EXTENSIONS = ['m4s', 'ts'];

/** Lower-cases a Content-Type header value and drops its parameters ("video/mp4; codecs=..."). */
export function normalizeContentType(raw: string | undefined): string {
  const mediaType = (raw ?? '').split(';')[0] ?? '';
  return mediaType.trim().toLowerCase();
}

/** The lower-case extension of the last path segment, without the dot; empty when there is none. */
export function extensionOf(pathname: string): string {
  const lastSegment = pathname.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot < 0) {
    return '';
  }
  return lastSegment.slice(dot + 1).toLowerCase();
}

/**
 * Says what a response or element source is, or nothing when it is not a
 * video or audio file or manifest. The content type wins; the extension is
 * used when the content type is missing or generic.
 */
export function detectType(contentType: string | undefined, pathname: string): DetectedType | undefined {
  const mediaType = normalizeContentType(contentType);
  const extension = extensionOf(pathname);

  if (extension === 'm3u8' || HLS_CONTENT_TYPES.includes(mediaType)) {
    return { kind: 'hls' };
  }
  if (extension === 'mpd' || DASH_CONTENT_TYPES.includes(mediaType)) {
    return { kind: 'dash' };
  }
  if (SEGMENT_EXTENSIONS.includes(extension)) {
    return undefined;
  }

  const byContentType = BY_CONTENT_TYPE[mediaType];
  if (byContentType) {
    return { kind: 'direct', file: byContentType };
  }

  const byExtension = BY_EXTENSION[extension];
  if (byExtension && GENERIC_CONTENT_TYPES.includes(mediaType)) {
    return { kind: 'direct', file: byExtension };
  }
  return undefined;
}
