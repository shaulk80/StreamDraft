import type { MediaItem } from '../../src/core/media.ts';
import { MOCK_MEDIA } from '../../src/core/mock-media.ts';
import { PING, type PongPayload } from '../../src/core/messages.ts';
import type { Result } from '../../src/core/result.ts';
import type { Settings } from '../../src/core/settings.ts';
import { MediaRegistry, registryKey } from '../../src/detect/registry.ts';
import { backgroundDownloadAction, demoDownloadAction, type DownloadAction } from '../../src/ui/download-client.ts';
import { renderMediaList } from '../../src/ui/media-view.ts';
import { SettingsStore } from '../../src/ui/settings-store.ts';

async function showBackgroundStatus(statusElement: HTMLElement): Promise<void> {
  try {
    const reply = (await browser.runtime.sendMessage({ type: PING })) as Result<PongPayload>;
    if (reply.ok) {
      statusElement.textContent = 'Background: ready';
      return;
    }
    statusElement.textContent = `Background: error (${reply.error})`;
  } catch (error) {
    console.error('StreamDraft: background did not answer', error);
    statusElement.textContent = 'Background: not responding';
  }
}

// Nothing is listed without a tab, so this never runs.
const noDownload: DownloadAction = () => Promise.resolve({ ok: false, error: 'No page to download from.' });

// For review and tests: "?mock=1" shows the four sample videos, "?mock=empty" the
// screen for a page without videos. Without it the popup shows what was found.
function mockVideos(): readonly MediaItem[] | undefined {
  const wanted = new URLSearchParams(window.location.search).get('mock');
  if (wanted === null) {
    return undefined;
  }
  return wanted === 'empty' ? [] : MOCK_MEDIA;
}

// The popup is shown over the tab it belongs to. "?tabUrl=PATTERN" (a match
// pattern such as "http://127.0.0.1/page.html*") picks the tab by address instead,
// which is how the smoke test (it opens the popup as a tab of its own) looks at a page.
async function resolveTabId(): Promise<number | undefined> {
  const pattern = new URLSearchParams(window.location.search).get('tabUrl');

  try {
    const query = pattern === null ? { active: true, currentWindow: true } : { url: pattern };
    const [tab] = await browser.tabs.query(query);
    return tab?.id;
  } catch (error) {
    console.error('StreamDraft: could not find the current tab', error);
    return undefined;
  }
}

/** Shows the videos found on the tab and keeps the list up to date while the popup is open. */
async function showTabVideos(
  list: HTMLElement,
  emptyNotice: HTMLElement,
  settings: Settings,
): Promise<void> {
  const tabId = await resolveTabId();
  if (tabId === undefined) {
    renderMediaList(list, emptyNotice, [], settings, noDownload);
    return;
  }
  const download = backgroundDownloadAction((message) => browser.runtime.sendMessage(message), tabId);

  const registry = new MediaRegistry(browser.storage.session);
  let shown: string | undefined;
  const refresh = async (): Promise<void> => {
    const items = await registry.list(tabId);
    // Redrawing would reset a quality choice the user just made; only redraw for new videos.
    const signature = items.map((item) => item.id).join('\n');
    if (signature === shown) {
      return;
    }
    shown = signature;
    renderMediaList(list, emptyNotice, items, settings, download);
  };

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'session' && registryKey(tabId) in changes) {
      void refresh();
    }
  });
  await refresh();
}

async function showVideos(): Promise<void> {
  const list = document.getElementById('media-list');
  const emptyNotice = document.getElementById('empty-notice');
  if (!list || !emptyNotice) {
    console.error('StreamDraft: popup is missing its list');
    return;
  }

  const settings = await new SettingsStore(browser.storage).load();
  const mock = mockVideos();
  if (mock) {
    renderMediaList(list, emptyNotice, mock, settings, demoDownloadAction(settings));
    document.getElementById('mode-note')?.removeAttribute('hidden');
    return;
  }
  await showTabVideos(list, emptyNotice, settings);
}

function wireSettingsLink(link: HTMLElement): void {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    browser.runtime.openOptionsPage().catch((error: unknown) => {
      console.error('StreamDraft: could not open the settings page', error);
    });
    window.close();
  });
}

const statusElement = document.getElementById('status');
if (statusElement) {
  void showBackgroundStatus(statusElement);
}

const settingsLink = document.getElementById('open-settings');
if (settingsLink) {
  wireSettingsLink(settingsLink);
}

void showVideos();
