import { demoDownloadMessage, handleMessage, parseFoundMediaMessage } from '../src/core/messages.ts';
import { demoDownloadText, downloadFilename, pickQuality } from '../src/core/media.ts';
import { DEMO_ITEM } from '../src/core/mock-media.ts';
import { NetworkObserver, type TabInfo } from '../src/detect/network-observer.ts';
import { addPageCandidates } from '../src/detect/page-reports.ts';
import { MediaRegistry } from '../src/detect/registry.ts';
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

  // Listeners are registered right away (not after an await): the browser can
  // stop this script at any time and wakes it for exactly these events.
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    const found = parseFoundMediaMessage(message);
    if (found.ok) {
      // The sender is a page's content script; its tab is the one the videos belong to.
      if (sender.tab?.id !== undefined) {
        void addPageCandidates(registry, sender.tab.id, found.value);
      }
      return undefined;
    }
    return Promise.resolve(handleMessage(message, startedAt));
  });

  store.onChange((settings) => void menu.apply(settings));

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ITEM_ID || tab?.id === undefined) {
      return;
    }
    void answerMenuClick(tab.id);
  });

  /** Finds videos from the network traffic of every tab and keeps them per tab. */
  function registerDetection(): void {
    const observer = new NetworkObserver({ registry, lookupTab });

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

  async function answerMenuClick(tabId: number): Promise<void> {
    const settings = await store.load();
    const option = pickQuality(DEMO_ITEM, settings.defaultQuality);
    if (!option) {
      console.error('StreamDraft: the demo video has no quality options');
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const name = downloadFilename(DEMO_ITEM, option, settings.filenameTemplate, date);
    try {
      // M1 only: nothing is downloaded, the page shows what would happen.
      await browser.tabs.sendMessage(tabId, demoDownloadMessage(demoDownloadText(name)), { frameId: 0 });
    } catch (error) {
      console.error('StreamDraft: the page did not answer the menu click', error);
    }
  }

  registerDetection();

  // The menu is rebuilt on every start, so it always matches the stored settings.
  void store.load().then((settings) => menu.apply(settings));
});
