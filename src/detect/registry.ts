import type { MediaItem, StreamDetails } from '../core/media.ts';
import { fail, ok, type Result } from '../core/result.ts';
import { isPartOf } from '../core/stream-parts.ts';
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

/** The storage key of a tab's list, so other parts can watch it with `storage.onChanged`. */
export function registryKey(tabId: number): string {
  return `${KEY_PREFIX}${tabId}`;
}

/** The tab a storage key belongs to, or undefined when the key is not a registry key. */
export function tabIdFromKey(key: string): number | undefined {
  if (!key.startsWith(KEY_PREFIX)) {
    return undefined;
  }

  const digits = key.slice(KEY_PREFIX.length);
  if (!/^\d+$/.test(digits)) {
    return undefined;
  }
  return Number(digits);
}

/** What reading one stream's manifest found out, for the item with this id. */
export interface ResolvedStream {
  id: string;
  details: StreamDetails;
}

/** True when a stream in the list names `id` as one of its parts (a rendition's playlist, a segment file). */
function isPartOfAStream(items: readonly MediaItem[], id: string): boolean {
  return items.some((item) => item.id !== id && isPartOf(item, id));
}

function withDetails(item: MediaItem, details: StreamDetails): MediaItem {
  // Cleared first, so details without an error or a reason also remove an old one.
  return { ...item, manifestError: undefined, protectedReason: undefined, partUrls: undefined, partRuns: undefined, ...details };
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

      // A player loads the playlists and segment files of a stream too; they are not videos of their own.
      if (isPartOfAStream(current.value, item.id)) {
        return ok(current.value);
      }

      const merged = this.cap(mergeItem(current.value, item));
      if (JSON.stringify(merged) === JSON.stringify(current.value)) {
        return ok(current.value);
      }
      return this.write(tabId, merged);
    });
  }

  /**
   * Gives every video of the tab the page's title. The title often arrives after
   * the first requests (the tab still shows the address while the page loads), so
   * videos found early would otherwise be named after the address. A tab without
   * videos is left alone, and so is a blank title.
   */
  retitle(tabId: number, title: string): Promise<Result<MediaItem[]>> {
    return this.enqueue(async () => {
      const current = await this.read(tabId);
      const wanted = title.trim();
      if (!current.ok || wanted === '') {
        return current;
      }

      const retitled = current.value.map((item) => (item.title === wanted ? item : { ...item, title: wanted }));
      if (retitled.every((item, index) => item === current.value[index])) {
        return current;
      }
      return this.write(tabId, retitled);
    });
  }

  /**
   * Stores what reading the manifests found out. Only the manifest's facts are
   * written, so a title set in the meantime is kept; an item that is gone (the
   * tab navigated) is left out. Items that turned out to be parts of a stream
   * (the playlists of a master playlist's renditions, the segment files a
   * manifest names) are dropped.
   */
  update(tabId: number, resolved: readonly ResolvedStream[]): Promise<Result<MediaItem[]>> {
    return this.enqueue(async () => {
      const current = await this.read(tabId);
      if (!current.ok) {
        return current;
      }

      const detailsById = new Map(resolved.map((entry) => [entry.id, entry.details]));
      const updated = current.value.map((item) => {
        const details = detailsById.get(item.id);
        return details === undefined ? item : withDetails(item, details);
      });
      const kept = updated.filter((item) => !isPartOfAStream(updated, item.id));
      if (JSON.stringify(kept) === JSON.stringify(current.value)) {
        return ok(current.value);
      }
      return this.write(tabId, kept);
    });
  }

  /** Forgets a tab's videos (the tab navigated or closed). */
  clear(tabId: number): Promise<Result<void>> {
    return this.enqueue(async () => {
      try {
        await this.area.remove(registryKey(tabId));
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
      const stored = await this.area.get(registryKey(tabId));
      const value = stored[registryKey(tabId)];
      return ok(Array.isArray(value) ? value.filter(isStoredItem) : []);
    } catch (error) {
      console.error(`StreamDraft: could not read the videos of tab ${tabId}`, error);
      return fail('The tab\'s videos could not be read.');
    }
  }

  private async write(tabId: number, items: MediaItem[]): Promise<Result<MediaItem[]>> {
    try {
      await this.area.set({ [registryKey(tabId)]: items });
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
