// The stream parts page (/parts.html), checked the same way in Firefox (WebDriver) and Chrome (DevTools).
// The page plays two DASH streams whose segments are separate .mp4 files of 120 KB; one stream is
// protected. The segments must not become videos of their own, and the manifests must be read
// without the popup being opened (the badge counts right from the start).

export const PARTS_PAGE = 'parts.html';
/** The popup lists the plain stream, the protected stream and the plain file direct.mp4. */
export const PARTS_CARD_COUNT = 3;

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
  if (plain === undefined || drm === undefined || items.length !== 2) {
    return `expected the two manifests, found ${items.map((item) => item.url).join(', ')}`;
  }
  if (plain.qualities === 0 || plain.protected) {
    return 'the plain manifest was not read in the background (no qualities yet)';
  }
  if (!drm.protected) {
    return 'the protected manifest was not read in the background (not marked protected)';
  }
  return undefined;
}
