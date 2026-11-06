import { fail, ok, type Result } from '../core/result.ts';
import type { Settings } from '../core/settings.ts';

export const MENU_ITEM_ID = 'streamdraft-download-video';
export const MENU_ITEM_TITLE = 'Download video with StreamDraft';

export interface MenuItemProperties {
  id: string;
  title: string;
  contexts: ['video'];
}

/** The part of `browser.contextMenus` the controller uses. */
export interface MenusLike {
  create(properties: MenuItemProperties): Promise<Result<void>>;
  removeAll(): Promise<void>;
}

/**
 * Keeps the right-click entry in line with the settings. Updates run one after
 * another: two quick toggles must not create the entry twice or leave it behind.
 * The entry is rebuilt from scratch each time, so it is also correct after the
 * background was stopped and started again.
 */
export class ContextMenuController {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly menus: MenusLike) {}

  /** Resolves when the menu matches `settings`. Never rejects. */
  apply(settings: Settings): Promise<void> {
    this.queue = this.queue.then(() => this.sync(settings.contextMenu));
    return this.queue;
  }

  private async sync(enabled: boolean): Promise<void> {
    try {
      await this.menus.removeAll();
    } catch (error) {
      console.error('StreamDraft: could not clear the context menu', error);
      return;
    }

    if (!enabled) {
      return;
    }

    const created = await this.createEntry();
    if (!created.ok) {
      console.error(`StreamDraft: could not add the context menu entry: ${created.error}`);
    }
  }

  private async createEntry(): Promise<Result<void>> {
    try {
      return await this.menus.create({ id: MENU_ITEM_ID, title: MENU_ITEM_TITLE, contexts: ['video'] });
    } catch (error) {
      console.error('StreamDraft: adding the context menu entry threw', error);
      return fail('The browser refused the context menu entry.');
    }
  }
}

/** The real `browser.contextMenus` as a `MenusLike`; errors come back as a Result. */
export function createMenusAdapter(
  contextMenus: {
    create(properties: MenuItemProperties, callback?: () => void): unknown;
    removeAll(): Promise<void>;
  },
  lastError: () => { message?: string } | undefined,
): MenusLike {
  return {
    create: (properties) =>
      new Promise((resolve) => {
        contextMenus.create(properties, () => {
          const error = lastError();
          resolve(error ? fail(error.message ?? 'Unknown error.') : ok(undefined));
        });
      }),
    removeAll: () => contextMenus.removeAll(),
  };
}
