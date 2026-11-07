import type { MediaItem } from '../core/media.ts';

/**
 * Adds an item to a list without duplicates: the same address seen again
 * (network and page scanner both find it) keeps the first item and only
 * learns what the first one lacked. Returns a new list.
 */
export function mergeItem(items: readonly MediaItem[], found: MediaItem): MediaItem[] {
  const index = items.findIndex((existing) => existing.id === found.id);
  if (index < 0) {
    return [...items, found];
  }

  const existing = items[index];
  if (!existing) {
    return [...items, found];
  }

  const merged = [...items];
  merged[index] = fillMissingSize(existing, found);
  return merged;
}

function fillMissingSize(existing: MediaItem, found: MediaItem): MediaItem {
  const foundSize = found.qualities[0]?.sizeBytes;
  const firstOption = existing.qualities[0];
  if (foundSize === undefined || !firstOption || firstOption.sizeBytes !== undefined) {
    return existing;
  }

  return { ...existing, qualities: [{ ...firstOption, sizeBytes: foundSize }, ...existing.qualities.slice(1)] };
}
