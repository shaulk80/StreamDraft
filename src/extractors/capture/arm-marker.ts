/**
 * The mark that tells the page-world hook, at the start of a page load, that
 * this load is to be recorded. The popup's Record button sets it (through the
 * content script) and reloads the tab; the hook reads it once and removes it.
 * It lives in the page's `sessionStorage`, which both worlds of the page share
 * and which is private to the tab. A page can read it, which tells it nothing
 * the extension needs to hide.
 */
export const ARM_KEY = 'streamdraft.capture.armed';

/** A mark older than this is left over from a reload that never happened and is ignored. */
export const ARM_VALID_MS = 60_000;

export interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Marks the next load of this tab as one to record. Returns false when the storage refuses (it is blocked in some frames and modes). */
export function armTab(storage: MarkerStorage, now: number): boolean {
  try {
    storage.setItem(ARM_KEY, String(now));
    return true;
  } catch (error) {
    console.error('StreamDraft: could not mark the tab for recording', error);
    return false;
  }
}

/** True once, when a fresh mark is there; the mark is removed. */
export function consumeArm(storage: MarkerStorage, now: number): boolean {
  try {
    const stored = storage.getItem(ARM_KEY);
    if (stored === null) {
      return false;
    }

    storage.removeItem(ARM_KEY);
    const armedAt = Number(stored);
    return Number.isFinite(armedAt) && now - armedAt >= 0 && now - armedAt <= ARM_VALID_MS;
  } catch (error) {
    console.error('StreamDraft: could not read the recording mark of the tab', error);
    return false;
  }
}
