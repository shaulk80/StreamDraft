import { DEMO_ITEM } from '../src/core/mock-media.ts';
import { demoDownloadAction } from '../src/ui/download-client.ts';
import { foundMediaMessage, parseDemoDownloadMessage } from '../src/core/messages.ts';
import { DomScanner } from '../src/detect/dom-scanner.ts';
import { showToast } from '../src/ui/toast.ts';
import { OverlayManager } from '../src/ui/overlay-manager.ts';
import { SettingsStore } from '../src/ui/settings-store.ts';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    const manager = new OverlayManager(window, DEMO_ITEM, demoDownloadAction);
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

    // The context menu entry (background) asks the page to show its demo answer.
    browser.runtime.onMessage.addListener((message: unknown) => {
      const demo = parseDemoDownloadMessage(message);
      if (demo.ok) {
        showToast(document, demo.value);
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
