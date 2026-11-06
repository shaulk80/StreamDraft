import { MOCK_MEDIA } from '../src/core/mock-media.ts';
import { OverlayManager } from '../src/ui/overlay-manager.ts';
import { SettingsStore } from '../src/ui/settings-store.ts';

// M1: every video gets the same fake item. M2 replaces it with detected media.
const DEMO_ITEM = MOCK_MEDIA.find((item) => item.id === 'mock-hls');

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    if (!DEMO_ITEM) {
      console.error('StreamDraft: the demo video is missing, no overlay will be shown');
      return;
    }

    const manager = new OverlayManager(window, DEMO_ITEM);
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

    void store.load().then(apply);
    store.onChange(apply);
  },
});
