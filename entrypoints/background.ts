import { demoDownloadMessage, handleMessage } from '../src/core/messages.ts';
import { demoDownloadText, downloadFilename, pickQuality } from '../src/core/media.ts';
import { DEMO_ITEM } from '../src/core/mock-media.ts';
import { ContextMenuController, createMenusAdapter, MENU_ITEM_ID } from '../src/ui/context-menu.ts';
import { SettingsStore } from '../src/ui/settings-store.ts';

export default defineBackground(() => {
  const startedAt = Date.now();
  const store = new SettingsStore(browser.storage);
  const menu = new ContextMenuController(
    createMenusAdapter(browser.contextMenus, () => browser.runtime.lastError ?? undefined),
  );

  // Listeners are registered right away (not after an await): the browser can
  // stop this script at any time and wakes it for exactly these events.
  browser.runtime.onMessage.addListener((message: unknown) => {
    return Promise.resolve(handleMessage(message, startedAt));
  });

  store.onChange((settings) => void menu.apply(settings));

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ITEM_ID || tab?.id === undefined) {
      return;
    }
    void answerMenuClick(tab.id);
  });

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

  // The menu is rebuilt on every start, so it always matches the stored settings.
  void store.load().then((settings) => menu.apply(settings));
});
