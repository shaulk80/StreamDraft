import { MOCK_MEDIA } from '../../src/core/mock-media.ts';
import { PING, type PongPayload } from '../../src/core/messages.ts';
import type { Result } from '../../src/core/result.ts';
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

// "?mock=empty" shows the screen for a page without videos, for review.
function mockVideos(): typeof MOCK_MEDIA {
  const wanted = new URLSearchParams(window.location.search).get('mock');
  return wanted === 'empty' ? [] : MOCK_MEDIA;
}

async function showVideos(): Promise<void> {
  const list = document.getElementById('media-list');
  const emptyNotice = document.getElementById('empty-notice');
  if (!list || !emptyNotice) {
    console.error('StreamDraft: popup is missing its list');
    return;
  }

  const settings = await new SettingsStore(browser.storage).load();
  renderMediaList(list, emptyNotice, mockVideos(), settings);
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
