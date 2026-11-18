// The stream parts page (/parts.html), checked the same way in Firefox (WebDriver) and Chrome (DevTools).
// The page plays four streams whose segments are separate .mp4 files of 120 KB: a DASH stream, a
// protected one, a DASH stream with two periods (not supported) and an HLS master whose segments
// are named only in its rendition playlists. The segments must not become videos of their own, and
// the manifests must be read without the popup being opened (the badge counts right from the start).

export const PARTS_PAGE = 'parts.html';
/** The popup lists the four streams and the plain file direct.mp4. */
export const PARTS_CARD_COUNT = 5;

/** A script for an extension page (not the popup, which reads the manifests itself): the stored lists of all tabs, as JSON. */
export function registryScript(api: 'browser' | 'chrome'): string {
  return `(async () => {
    const all = await ${api}.storage.session.get(null);
    const items = Object.entries(all).filter(([key]) => key.startsWith('streamdraft.tab.')).flatMap(([, list]) => list);
    return JSON.stringify(items.map((item) => ({ url: item.url, kind: item.kind, protected: item.protected, qualities: item.qualities.length })));
  })()`;
}

interface StoredItem {
  url: string;
  kind: string;
  protected: boolean;
  qualities: number;
}

/** What is wrong with the notices the popup shows on the parts page (one for the protected stream, one for the two periods), or undefined. */
export function noticesProblem(notices: string[] | undefined): string | undefined {
  const found = notices ?? [];
  const protectedNotices = found.filter((notice) => notice.includes('Widevine DRM'));
  const periodNotices = found.filter((notice) => notice.includes('several periods'));
  if (found.length !== 2 || protectedNotices.length !== 1 || periodNotices.length !== 1) {
    return `expected a Widevine notice and a several-periods notice, got ${JSON.stringify(notices)}`;
  }
  return undefined;
}

/** What is wrong with the stored lists after the page played its streams, or undefined when all is right. */
export function partsProblem(json: string | undefined): string | undefined {
  if (json === undefined) {
    return 'the stored lists could not be read';
  }

  const items = (JSON.parse(json) as StoredItem[]).filter((item) => item.url.includes('/parts/'));
  const segments = items.filter((item) => item.kind === 'direct');
  if (segments.length > 0) {
    return `segment files are listed as videos: ${segments.map((item) => item.url).join(', ')}`;
  }

  const plain = items.find((item) => item.url.endsWith('/parts/plain.mpd'));
  const drm = items.find((item) => item.url.endsWith('/parts/drm.mpd'));
  const periods = items.find((item) => item.url.endsWith('/parts/periods.mpd'));
  const master = items.find((item) => item.url.endsWith('/parts/hls/master.m3u8'));
  if (plain === undefined || drm === undefined || periods === undefined || master === undefined || items.length !== 4) {
    return `expected the four manifests, found ${items.map((item) => item.url).join(', ')}`;
  }
  if (plain.qualities === 0 || plain.protected) {
    return 'the plain manifest was not read in the background (no qualities yet)';
  }
  if (!drm.protected) {
    return 'the protected manifest was not read in the background (not marked protected)';
  }
  if (master.qualities === 0) {
    return 'the HLS master was not read in the background (no qualities yet)';
  }
  if (periods.qualities !== 0 || periods.protected) {
    return 'the manifest with two periods was expected to be unsupported (no qualities)';
  }
  return undefined;
}
