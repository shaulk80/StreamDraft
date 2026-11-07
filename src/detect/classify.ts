import type { MediaCandidate, MediaItem } from '../core/media.ts';
import { fail, ok, type Result } from '../core/result.ts';
import { addressWithoutFragment, fileNameOf } from '../core/url-names.ts';
import { detectType, type FileType } from './media-types.ts';

/** Smaller files are tracking clips, ads and previews, not something to download. */
export const MIN_DIRECT_SIZE_BYTES = 100 * 1024;

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Decides whether a candidate is a downloadable direct file and builds its
 * item. The error says why it is not, so callers can log it at debug level.
 * HLS and DASH manifests are recognised but rejected until M3 can fetch them.
 */
export function classifyCandidate(candidate: MediaCandidate): Result<MediaItem> {
  if (!URL.canParse(candidate.url)) {
    return fail(`Not a valid address: ${candidate.url}`);
  }

  const url = new URL(candidate.url);
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    return fail(`Only http and https files can be downloaded, not ${url.protocol}`);
  }

  const detected = detectType(candidate.contentType, url.pathname);
  if (!detected) {
    return fail('Not a video or audio file.');
  }
  if (detected.kind !== 'direct') {
    return fail(`${detected.kind.toUpperCase()} streams are not supported yet.`);
  }

  const { sizeBytes } = candidate;
  if (sizeBytes !== undefined && sizeBytes < MIN_DIRECT_SIZE_BYTES) {
    return fail('Too small to be a video.');
  }

  return ok(buildItem(url, detected.file, candidate));
}

function buildItem(url: URL, file: FileType, candidate: MediaCandidate): MediaItem {
  const label = file.audioOnly ? `${file.container.toUpperCase()} audio` : file.container.toUpperCase();
  const address = addressWithoutFragment(url.href) ?? url.href;
  return {
    id: address,
    url: address,
    title: titleOf(url, candidate.pageTitle),
    site: siteOf(url, candidate.pageUrl),
    kind: 'direct',
    container: file.container,
    // A plain file has one quality: itself. Its height is not known without reading it.
    qualities: [{ quality: 'best', label, sizeBytes: candidate.sizeBytes }],
    protected: false,
  };
}

function titleOf(url: URL, pageTitle: string | undefined): string {
  const fromPage = pageTitle?.trim() ?? '';
  if (fromPage !== '') {
    return fromPage;
  }

  const fileName = fileNameOf(url.pathname).replace(/\.[^.]*$/, '');
  if (fileName !== '') {
    return fileName;
  }
  return hostOf(url);
}

function siteOf(url: URL, pageUrl: string | undefined): string {
  if (pageUrl !== undefined && URL.canParse(pageUrl)) {
    return hostOf(new URL(pageUrl));
  }
  return hostOf(url);
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./, '');
}
