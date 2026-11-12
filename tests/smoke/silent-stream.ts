import { waitForCard, type PopupPage } from './job-display.ts';
import { saveSoundScript } from './stream-download.ts';

// The page /silent.html has one DASH stream with a picture and no sound track. "Audio only" on it
// must end with the words for a video without sound, and nothing may be saved. Checked the same way
// in Firefox (WebDriver) and Chrome (DevTools).

export const SILENT_PAGE = 'silent.html';
export const SILENT_PAGE_TITLE = 'StreamDraft silent stream test page';

const FAILED = 'Could not save the video.';
const NO_SOUND = 'This video has no sound to save.';

/** True for a file the silent stream's job saved (named after the page). */
export function isSilentStreamFile(name: string): boolean {
  return name.startsWith(SILENT_PAGE_TITLE);
}

/**
 * Presses "Audio only" and Download on the only card and waits for the card to end. Returns a problem
 * text, or undefined when the card says there is no sound and the Download button is back. Whether a
 * file was saved is for the caller to see in the download folder.
 */
export async function silentStreamProblem(popup: PopupPage): Promise<string | undefined> {
  await popup.act(saveSoundScript(0));
  const view = await waitForCard(popup, 0, (card) => card.text.startsWith(FAILED) && !card.downloadDisabled);
  if (!view?.text.startsWith(FAILED) || !view.text.includes(NO_SOUND) || view.downloadDisabled) {
    const shown = await popup.read("document.getElementById('media-list').innerText");
    return `the silent stream did not end with "${FAILED} ${NO_SOUND}": ${JSON.stringify(view)}; the popup shows ${JSON.stringify(shown)}`;
  }
  return undefined;
}
