import { tabIdFromKey } from '../detect/registry.ts';

/** The part of `browser.action` the badge uses. */
export interface ActionLike {
  setBadgeText(details: { tabId: number; text: string }): Promise<void>;
}

/** Changes of a storage area, as `storage.onChanged` reports them. */
export type StorageChangeMap = Record<string, { newValue?: unknown }>;

const MAX_SHOWN = 99;

/** Nothing for no videos, the number up to 99, then "99+". */
export function badgeText(count: number): string {
  if (count <= 0) {
    return '';
  }
  return count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);
}

/**
 * Shows how many videos were found on a tab on the toolbar button. It follows
 * the registry's storage changes, so it does not matter whether the network
 * observer or the page scanner found the video, or that the tab navigated.
 */
export class BadgeController {
  constructor(private readonly action: ActionLike) {}

  /** For a `storage.onChanged` listener; changes of other keys and other areas are ignored. */
  async onStorageChanged(changes: StorageChangeMap, areaName: string): Promise<void> {
    if (areaName !== 'session') {
      return;
    }

    for (const [key, change] of Object.entries(changes)) {
      const tabId = tabIdFromKey(key);
      if (tabId !== undefined) {
        await this.show(tabId, Array.isArray(change.newValue) ? change.newValue.length : 0);
      }
    }
  }

  private async show(tabId: number, count: number): Promise<void> {
    try {
      await this.action.setBadgeText({ tabId, text: badgeText(count) });
    } catch (error) {
      // The tab can be closed between the change and this call.
      console.error(`StreamDraft: could not set the badge of tab ${tabId}`, error);
    }
  }
}
