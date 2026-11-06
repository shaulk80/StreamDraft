import { fail, ok, type Result } from '../core/result.ts';
import { normalizeSettings, SETTINGS_KEY, validateSettings, type Settings } from '../core/settings.ts';

/** The part of a `storage` area (sync or local) the store uses. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type StorageChanges = Record<string, { newValue?: unknown }>;

/** The part of `browser.storage` the store uses. `sync` is missing in some browsers. */
export interface StorageLike {
  sync?: StorageAreaLike;
  local: StorageAreaLike;
  onChanged: {
    addListener(listener: (changes: StorageChanges, areaName: string) => void): void;
  };
}

export type SettingsListener = (settings: Settings) => void;

/**
 * Reads and writes the settings in `storage.sync`, or `storage.local` when sync
 * does not exist, and tells listeners when they change (from any page of the
 * extension), so toggles apply without a reload.
 */
export class SettingsStore {
  private readonly area: StorageAreaLike;
  private readonly areaName: 'sync' | 'local';

  constructor(private readonly storage: StorageLike) {
    this.areaName = storage.sync ? 'sync' : 'local';
    this.area = storage.sync ?? storage.local;
  }

  /** Never fails: a read error or corrupt data gives the defaults (the error is logged). */
  async load(): Promise<Settings> {
    try {
      const stored = await this.area.get(SETTINGS_KEY);
      return normalizeSettings(stored[SETTINGS_KEY]);
    } catch (error) {
      console.error('StreamDraft: could not read settings, using defaults', error);
      return normalizeSettings(undefined);
    }
  }

  async save(settings: Settings): Promise<Result<Settings>> {
    const valid = validateSettings(settings);
    if (!valid.ok) {
      return valid;
    }

    try {
      await this.area.set({ [SETTINGS_KEY]: settings });
      return ok(settings);
    } catch (error) {
      console.error('StreamDraft: could not save settings', error);
      return fail('Settings could not be saved.');
    }
  }

  /** Calls `listener` with the new settings whenever they change in the store. */
  onChange(listener: SettingsListener): void {
    this.storage.onChanged.addListener((changes, areaName) => {
      const change = changes[SETTINGS_KEY];
      if (areaName !== this.areaName || change === undefined) {
        return;
      }
      listener(normalizeSettings(change.newValue));
    });
  }
}
