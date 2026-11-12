import {
  handleMessage,
  parseCancelJobMessage,
  parseDownloadMediaMessage,
  parseFoundMediaMessage,
  parseResolveStreamsMessage,
  showTextMessage,
} from '../src/core/messages.ts';
import { createBrowserEngine } from '../src/engine/browser-engine.ts';
import { DownloadService } from '../src/engine/download-service.ts';
import { parseEngineSignalMessage } from '../src/engine/engine-messages.ts';
import type { EngineEvent, EngineHost } from '../src/engine/engine-types.ts';
import { DownloadHandoffs, JobCoordinator } from '../src/engine/job-coordinator.ts';
import { JobStateStore } from '../src/engine/job-state.ts';
import { LocalEngineHost } from '../src/engine/local-engine-host.ts';
import { OffscreenEngineHost, type OffscreenApi } from '../src/engine/offscreen-engine-host.ts';
import { NetworkObserver, type TabInfo } from '../src/detect/network-observer.ts';
import { createManifestFetcher } from '../src/detect/manifest-fetch.ts';
import { addPageCandidates } from '../src/detect/page-reports.ts';
import { MediaRegistry } from '../src/detect/registry.ts';
import { StreamResolver } from '../src/detect/stream-resolver.ts';
import { fail, ok } from '../src/core/result.ts';
import { BadgeController } from '../src/ui/badge.ts';
import { ContextMenuController, createMenusAdapter, MENU_ITEM_ID } from '../src/ui/context-menu.ts';
import { SettingsStore } from '../src/ui/settings-store.ts';

export default defineBackground(() => {
  const startedAt = Date.now();
  const store = new SettingsStore(browser.storage);
  const menu = new ContextMenuController(
    createMenusAdapter(browser.contextMenus, () => browser.runtime.lastError ?? undefined),
  );

  const registry = new MediaRegistry(browser.storage.session);
  const resolver = new StreamResolver(registry, createManifestFetcher((url, init) => fetch(url, init)));

  // Streams are downloaded by the engine: in this page on Firefox, in an offscreen
  // document on Chrome (decision 0003). Its news comes back as events.
  const onEngineEvent = (event: EngineEvent): void => void coordinator.handleEvent(event);
  const offscreenHost = import.meta.env.FIREFOX ? undefined : new OffscreenEngineHost(createOffscreenApi(), onEngineEvent);
  const engineHost: EngineHost =
    offscreenHost ??
    new LocalEngineHost(
      createBrowserEngine((signal) => {
        if (signal.kind !== 'idle') {
          onEngineEvent(signal);
        }
      }),
    );
  const coordinator = new JobCoordinator({
    host: engineHost,
    downloads: browser.downloads,
    states: new JobStateStore(browser.storage.local),
    handoffs: new DownloadHandoffs(browser.storage.session),
    newJobId: () => crypto.randomUUID(),
    now: () => Date.now(),
  });

  const downloads = new DownloadService({
    downloads: browser.downloads,
    listItems: (tabId) => registry.list(tabId),
    loadSettings: () => store.load(),
    today: () => new Date().toISOString().slice(0, 10),
    streams: coordinator,
  });

  // Listeners are registered right away (not after an await): the browser can
  // stop this script at any time and wakes it for exactly these events.
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    const signal = parseEngineSignalMessage(message);
    if (signal.ok) {
      // Only the engine's own document reports; a page's content script has a tab and is not believed.
      if (sender.tab === undefined) {
        void offscreenHost?.receive(signal.value);
      }
      return undefined;
    }

    const found = parseFoundMediaMessage(message);
    if (found.ok) {
      // The sender is a page's content script; its tab is the one the videos belong to.
      if (sender.tab?.id === undefined) {
        return undefined;
      }
      // Answered after the videos are stored: a page that rescans on request waits for it.
      return addPageCandidates(registry, sender.tab.id, found.value).then((count) => ok(count));
    }

    const resolve = parseResolveStreamsMessage(message);
    if (resolve.ok) {
      // Only the popup asks; it names the tab it is shown over.
      return resolver.resolveTab(resolve.value).then((count) => ok(count));
    }

    const cancel = parseCancelJobMessage(message);
    if (cancel.ok) {
      // The job ends with its own "cancelled" state, which the popup reads from storage.
      return coordinator.cancel(cancel.value).then(() => ok(undefined));
    }

    const download = parseDownloadMediaMessage(message);
    if (download.ok) {
      // Only the popup names a tab (it asks about the page behind it, and when it is
      // opened as a tab of its own, as in the smoke test, `sender.tab` is the popup
      // itself). A page's content script names none, so its own tab is used.
      const tabId = download.value.tabId ?? sender.tab?.id;
      if (tabId === undefined) {
        return Promise.resolve(fail('The download request names no tab.'));
      }
      return downloads.start(tabId, download.value);
    }

    return Promise.resolve(handleMessage(message, startedAt));
  });

  store.onChange((settings) => void menu.apply(settings));

  // A finished stream is given to the browser's downloads; this says when the browser is done with it.
  browser.downloads.onChanged.addListener((change) => void coordinator.handleDownloadChange(change));

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ITEM_ID || tab?.id === undefined) {
      return;
    }
    void answerMenuClick(tab.id, info.srcUrl);
  });

  /** Finds videos from the network traffic of every tab and keeps them per tab. */
  function registerDetection(): void {
    // A stream's manifest is read as soon as it is found: it names the stream's own
    // files (segments, rendition playlists), which must not be listed as videos.
    const observer = new NetworkObserver({ registry, lookupTab, onStreamFound: (tabId) => void resolver.resolveTab(tabId) });

    // A new page in a tab starts with an empty list. Seen before the response
    // of the new page, so a video opened as the page itself is not lost.
    browser.webRequest.onBeforeRequest.addListener(
      (details) => void observer.handleRequestStart(details),
      { urls: ['<all_urls>'], types: ['main_frame'] },
    );
    browser.webRequest.onHeadersReceived.addListener(
      (details) => void observer.handleResponse(details),
      { urls: ['<all_urls>'], types: ['main_frame', 'media', 'xmlhttprequest', 'object', 'other'] },
      ['responseHeaders'],
    );
    browser.tabs.onRemoved.addListener((tabId) => void registry.clear(tabId));
    // The page title usually arrives after the first video was found: name the videos after it.
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.title !== undefined) {
        void registry.retitle(tabId, changeInfo.title);
      }
    });

    // The toolbar badge follows the registry, whoever added to it.
    const badge = new BadgeController(browser.action);
    browser.storage.onChanged.addListener((changes, areaName) => void badge.onStorageChanged(changes, areaName));
    browser.action.setBadgeBackgroundColor({ color: '#2563eb' }).catch((error: unknown) => {
      console.error('StreamDraft: could not set the badge colour', error);
    });
  }

  async function lookupTab(tabId: number): Promise<TabInfo | undefined> {
    try {
      const tab = await browser.tabs.get(tabId);
      return { url: tab.url, title: tab.title };
    } catch (error) {
      console.error(`StreamDraft: could not read tab ${tabId}`, error);
      return undefined;
    }
  }

  /** Downloads the clicked video and tells the page what happened. */
  async function answerMenuClick(tabId: number, srcUrl: string | undefined): Promise<void> {
    const started = await downloads.startForAddress(tabId, srcUrl);
    const text = started.ok ? `Saving as "${started.value.filename}".` : started.error;
    try {
      await browser.tabs.sendMessage(tabId, showTextMessage(text), { frameId: 0 });
    } catch (error) {
      console.error('StreamDraft: the page did not answer the menu click', error);
    }
  }

  /** The Chrome calls that open, find and close the engine's offscreen document. */
  function createOffscreenApi(): OffscreenApi {
    return {
      hasDocument: async () => (await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0,
      createDocument: () =>
        browser.offscreen.createDocument({
          url: browser.runtime.getURL('/offscreen.html'),
          reasons: ['BLOBS'],
          justification: 'Joins the parts of a streamed video into one file and gives it to the browser to save.',
        }),
      closeDocument: () => browser.offscreen.closeDocument(),
      send: (message) => browser.runtime.sendMessage(message),
    };
  }

  registerDetection();

  // The menu is rebuilt on every start, so it always matches the stored settings.
  void store.load().then((settings) => menu.apply(settings));
});
