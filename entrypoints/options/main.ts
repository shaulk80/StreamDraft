import {
  fillQualityChoices,
  findControls,
  readSettings,
  showPreview,
  showStatus,
  writeSettings,
  type OptionsControls,
} from '../../src/ui/options-form.ts';
import { SettingsStore } from '../../src/ui/settings-store.ts';

// Saves finish in their own time. Only the latest edit may write the status,
// or a slow save of an older value would say "Saved." beside a newer bad value.
let latestEdit = 0;

async function saveFromForm(store: SettingsStore, controls: OptionsControls): Promise<void> {
  latestEdit += 1;
  const thisEdit = latestEdit;

  const read = readSettings(controls);
  if (!read.ok) {
    showStatus(controls, read.error, true);
    return;
  }

  showPreview(controls, read.value);
  const saved = await store.save(read.value);
  if (thisEdit !== latestEdit) {
    return;
  }
  if (saved.ok) {
    showStatus(controls, 'Saved.', false);
    return;
  }
  showStatus(controls, saved.error, true);
}

async function start(): Promise<void> {
  const controls = findControls(document);
  if (!controls) {
    return;
  }

  const store = new SettingsStore(browser.storage);
  fillQualityChoices(controls.defaultQuality);
  writeSettings(controls, await store.load());

  const form = document.getElementById('settings-form');
  // The site list is saved when the user leaves it, not on every key: half a name is not a site.
  form?.addEventListener('input', (event) => {
    if (event.target !== controls.playerCaptureSites) {
      void saveFromForm(store, controls);
    }
  });
  controls.playerCaptureSites.addEventListener('change', () => void saveFromForm(store, controls));
  form?.addEventListener('submit', (event) => event.preventDefault());

  // A change made in another options tab shows up here. While this tab has
  // focus the change events are echoes of its own saves, which can arrive late
  // and would overwrite what the user is typing, so they are ignored.
  store.onChange((settings) => {
    if (document.hasFocus()) {
      return;
    }
    writeSettings(controls, settings);
  });
}

void start();
