import type { MediaItem } from '../core/media.ts';
import { fail, ok, type Result } from '../core/result.ts';
import { mergeItem } from './merge.ts';

/** The part of `browser.storage.session` the registry uses. */
export interface SessionAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Most items kept per tab; the oldest go first. A page that streams endlessly must not fill the storage. */
export const MAX_ITEMS_PER_TAB = 50;

const KEY_PREFIX = 'streamdraft.tab.';

function keyOf(tabId: number): string {
  return `${KEY_PREFIX}${tabId}`;
}

function isStoredItem(value: unknown): value is MediaItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof MediaItem, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.qualities)
  );
}

/**
 * The videos found in each tab. Lives in `storage.session` because the
 * background can be stopped at any time and module variables would be lost
 * with it. Calls are run one after another: many requests arrive together,
 * and two unsynchronised read-modify-write cycles would lose items.
 */
export class MediaRegistry {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly area: SessionAreaLike,
    private readonly maxItems: number = MAX_ITEMS_PER_TAB,
  ) {}

  /** Never fails: a read error gives an empty list (the error is logged). */
  list(tabId: number): Promise<MediaItem[]> {
    return this.enqueue(async () => {
      const items = await this.read(tabId);
      return items.ok ? items.value : [];
    });
  }

  /** Adds a found item; the same address again only fills in what was missing. Returns the tab's list. */
  add(tabId: number, item: MediaItem): Promise<Result<MediaItem[]>> {
    return this.enqueue(async () => {
      const current = await this.read(tabId);
      if (!current.ok) {
        return current;
      }

      const merged = this.cap(mergeItem(current.value, item));
      if (JSON.stringify(merged) === JSON.stringify(current.value)) {
        return ok(current.value);
      }
      return this.write(tabId, merged);
    });
  }

  /** Forgets a tab's videos (the tab navigated or closed). */
  clear(tabId: number): Promise<Result<void>> {
    return this.enqueue(async () => {
      try {
        await this.area.remove(keyOf(tabId));
        return ok(undefined);
      } catch (error) {
        console.error(`StreamDraft: could not clear the videos of tab ${tabId}`, error);
        return fail('The tab\'s videos could not be cleared.');
      }
    });
  }

  private cap(items: MediaItem[]): MediaItem[] {
    return items.length > this.maxItems ? items.slice(items.length - this.maxItems) : items;
  }

  private async read(tabId: number): Promise<Result<MediaItem[]>> {
    try {
      const stored = await this.area.get(keyOf(tabId));
      const value = stored[keyOf(tabId)];
      return ok(Array.isArray(value) ? value.filter(isStoredItem) : []);
    } catch (error) {
      console.error(`StreamDraft: could not read the videos of tab ${tabId}`, error);
      return fail('The tab\'s videos could not be read.');
    }
  }

  private async write(tabId: number, items: MediaItem[]): Promise<Result<MediaItem[]>> {
    try {
      await this.area.set({ [keyOf(tabId)]: items });
      return ok(items);
    } catch (error) {
      console.error(`StreamDraft: could not save the videos of tab ${tabId}`, error);
      return fail('The tab\'s videos could not be saved.');
    }
  }

  /** Runs `job` after every earlier job has finished, whether it succeeded or not. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(job, job);
    this.queue = result;
    return result;
  }
}
