import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from '../../src/core/settings.ts';
import {
  SettingsStore,
  type StorageAreaLike,
  type StorageChanges,
  type StorageLike,
} from '../../src/ui/settings-store.ts';

class MemoryArea implements StorageAreaLike {
  data: Record<string, unknown> = {};
  failWith: Error | undefined;

  get(key: string): Promise<Record<string, unknown>> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    return Promise.resolve(key in this.data ? { [key]: this.data[key] } : {});
  }

  set(items: Record<string, unknown>): Promise<void> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    Object.assign(this.data, items);
    return Promise.resolve();
  }
}

type ChangeListener = (changes: StorageChanges, areaName: string) => void;

function createStorage(withSync: boolean) {
  const sync = new MemoryArea();
  const local = new MemoryArea();
  const listeners: ChangeListener[] = [];
  const storage: StorageLike = {
    ...(withSync ? { sync } : {}),
    local,
    onChanged: { addListener: (listener) => listeners.push(listener) },
  };
  const emit: ChangeListener = (changes, areaName) => listeners.forEach((listener) => listener(changes, areaName));
  return { storage, sync, local, emit };
}

const CHANGED: Settings = { ...DEFAULT_SETTINGS, inPageButton: false, defaultQuality: '480p' };

describe('SettingsStore', () => {
  test('load gives the defaults when nothing is stored', async () => {
    const { storage } = createStorage(true);

    expect(await new SettingsStore(storage).load()).toEqual(DEFAULT_SETTINGS);
  });

  test.each([
    ['sync when it exists', true, 'sync'],
    ['local when there is no sync', false, 'local'],
  ] as const)('saves and loads through %s', async (_name, withSync, expectedArea) => {
    const { storage, sync, local } = createStorage(withSync);
    const store = new SettingsStore(storage);

    const saved = await store.save(CHANGED);

    expect(saved.ok).toBe(true);
    expect(await store.load()).toEqual(CHANGED);
    const used = expectedArea === 'sync' ? sync : local;
    expect(used.data[SETTINGS_KEY]).toEqual(CHANGED);
  });

  test('load falls back to the defaults for corrupt data', async () => {
    const { storage, sync } = createStorage(true);
    sync.data[SETTINGS_KEY] = { inPageButton: 'x', defaultQuality: 'huge' };

    expect(await new SettingsStore(storage).load()).toEqual(DEFAULT_SETTINGS);
  });

  test('load falls back to the defaults when storage fails', async () => {
    const { storage, sync } = createStorage(true);
    sync.failWith = new Error('quota');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await new SettingsStore(storage).load()).toEqual(DEFAULT_SETTINGS);
  });

  test('save reports invalid settings and stores nothing', async () => {
    const { storage, sync } = createStorage(true);

    const result = await new SettingsStore(storage).save({ ...DEFAULT_SETTINGS, filenameTemplate: '{nope}' });

    expect(result.ok).toBe(false);
    expect(sync.data).toEqual({});
  });

  test('save reports a storage failure', async () => {
    const { storage, sync } = createStorage(true);
    sync.failWith = new Error('quota');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await new SettingsStore(storage).save(CHANGED);

    expect(result.ok).toBe(false);
  });

  describe('onChange', () => {
    test('passes the new settings to the listener', () => {
      const { storage, emit } = createStorage(true);
      const listener = vi.fn();
      new SettingsStore(storage).onChange(listener);

      emit({ [SETTINGS_KEY]: { newValue: CHANGED } }, 'sync');

      expect(listener).toHaveBeenCalledWith(CHANGED);
    });

    test.each([
      ['another storage area', { [SETTINGS_KEY]: { newValue: CHANGED } }, 'local'],
      ['another key', { other: { newValue: 1 } }, 'sync'],
    ])('ignores a change in %s', (_name, changes, areaName) => {
      const { storage, emit } = createStorage(true);
      const listener = vi.fn();
      new SettingsStore(storage).onChange(listener);

      emit(changes, areaName);

      expect(listener).not.toHaveBeenCalled();
    });

    test('gives the defaults when the key was removed', () => {
      const { storage, emit } = createStorage(true);
      const listener = vi.fn();
      new SettingsStore(storage).onChange(listener);

      emit({ [SETTINGS_KEY]: {} }, 'sync');

      expect(listener).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    });
  });
});
