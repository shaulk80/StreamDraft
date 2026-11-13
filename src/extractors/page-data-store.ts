import { fail, ok, type Result } from '../core/result.ts';
import type { PageData } from '../core/page-data.ts';

/** The part of `browser.storage.session` the store uses. */
export interface PageDataAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The storage key of one page variable of a tab. */
export function pageDataKey(tabId: number, name: string): string {
  return `streamdraft.page-data.${tabId}.${name}`;
}

/**
 * Keeps the newest value of each page variable per tab in `storage.session`
 * (the background can be stopped at any time). A new value replaces the old one.
 */
export class PageDataStore {
  constructor(private readonly area: PageDataAreaLike) {}

  async save(tabId: number, data: PageData): Promise<Result<void>> {
    try {
      await this.area.set({ [pageDataKey(tabId, data.name)]: data.json });
      return ok(undefined);
    } catch (error) {
      console.error('StreamDraft: could not store page data', error);
      return fail('Could not store the page data.');
    }
  }

  /** The JSON text of a variable, or undefined when the page has not reported it. */
  async load(tabId: number, name: string): Promise<string | undefined> {
    const key = pageDataKey(tabId, name);
    try {
      const stored = await this.area.get(key);
      const value = stored[key];
      return typeof value === 'string' ? value : undefined;
    } catch (error) {
      console.error('StreamDraft: could not read page data', error);
      return undefined;
    }
  }

  async clear(tabId: number, name: string): Promise<void> {
    try {
      await this.area.remove(pageDataKey(tabId, name));
    } catch (error) {
      console.error('StreamDraft: could not clear page data', error);
    }
  }
}
