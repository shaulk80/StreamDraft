import { backgroundDownloadAction } from '../src/ui/download-client.ts';
import { foundMediaMessage, parseShowTextMessage } from '../src/core/messages.ts';
import { DomScanner } from '../src/detect/dom-scanner.ts';
import { showToast } from '../src/ui/toast.ts';
import { OverlayManager } from '../src/ui/overlay-manager.ts';
import { SettingsStore } from '../src/ui/settings-store.ts';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // The background knows this page's tab from the sender, so no tab is named.
    const download = backgroundDownloadAction((message) => browser.runtime.sendMessage(message));
    const manager = new OverlayManager(window, () => download);
    const store = new SettingsStore(browser.storage);

    // Both the first load and later changes end up here, so the setting
    // applies live without reloading the page.
    const apply = (settings: Awaited<ReturnType<SettingsStore['load']>>): void => {
      if (settings.inPageButton) {
        manager.start(settings);
        return;
      }
      manager.stop();
    };

    // The context menu entry (background) asks the page to show what happened.
    browser.runtime.onMessage.addListener((message: unknown) => {
      const text = parseShowTextMessage(message);
      if (text.ok) {
        showToast(document, text.value);
      }
    });

    // Videos in the page are reported to the background, which keeps the list per tab.
    // Reporting does not depend on the in-page button setting.
    new DomScanner(window, (candidates) => {
      browser.runtime.sendMessage(foundMediaMessage(candidates)).catch((error: unknown) => {
        console.error('StreamDraft: could not report the videos of this page', error);
      });
    }).start();

    void store.load().then(apply);
    store.onChange(apply);
  },
});
