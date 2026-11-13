// The main world test page (/main-world.html), checked the same way in Firefox (WebDriver) and Chrome (DevTools).
// The page keeps a player response in a variable of its own scripts. The extension's MAIN-world script
// must read it, and the background must hold it for the tab.

export const MAIN_WORLD_PAGE = 'main-world.html';

/** A script for an extension page: the stored page variables of all tabs, as JSON ({ key, json } pairs). */
export function pageDataScript(api: 'browser' | 'chrome'): string {
  return `(async () => {
    const all = await ${api}.storage.session.get(null);
    const found = Object.entries(all).filter(([key]) => key.startsWith('streamdraft.page-data.')).map(([key, json]) => ({ key, json }));
    return JSON.stringify(found);
  })()`;
}

interface StoredPageData {
  key: string;
  json: string;
}

/** What is wrong with the stored page variables after the page loaded, or undefined when all is right. */
export function pageDataProblem(stored: string | undefined): string | undefined {
  if (stored === undefined) {
    return 'the stored page data could not be read';
  }

  const entries = JSON.parse(stored) as StoredPageData[];
  const entry = entries.find((candidate) => candidate.key.endsWith('.ytInitialPlayerResponse'));
  if (entry === undefined) {
    return 'the page variable ytInitialPlayerResponse was not stored';
  }

  const value = JSON.parse(entry.json) as { videoDetails?: { videoId?: string; title?: string } };
  if (value.videoDetails?.videoId !== 'spike-video-1' || value.videoDetails.title !== 'Main world test video') {
    return `the stored value is not the page's: ${entry.json.slice(0, 120)}`;
  }
  return undefined;
}
