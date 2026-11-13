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

/** Time to let a page run its scripts to the end and the background store what they posted, before saying that nothing was. */
export const NOTHING_HAPPENS_MS = 2000;
/** Time for the background to register or remove the capture script after the setting changed. */
export const SETTING_SETTLE_MS = 1500;

/** A script for an extension page: switches the player capture on or off for the given sites, keeping the other settings. */
export function captureSettingScript(api: 'browser' | 'chrome', on: boolean, sites: string[]): string {
  return `(async () => {
    const area = ${api}.storage.sync ?? ${api}.storage.local;
    const stored = await area.get('settings');
    await area.set({ settings: { ...(stored.settings ?? {}), playerCapture: ${String(on)}, playerCaptureSites: ${JSON.stringify(sites)} } });
    return 'done';
  })()`;
}

/** A script for an extension page: forgets the stored page variables of all tabs. */
export function clearPageDataScript(api: 'browser' | 'chrome'): string {
  return `(async () => {
    const all = await ${api}.storage.session.get(null);
    await ${api}.storage.session.remove(Object.keys(all).filter((key) => key.startsWith('streamdraft.page-data.')));
    return 'done';
  })()`;
}

/** True when the stored page variables hold anything at all. */
export function hasPageData(stored: string | undefined): boolean {
  return stored !== undefined && (JSON.parse(stored) as unknown[]).length > 0;
}
