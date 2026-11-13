import { describe, expect, test } from 'vitest';
import { PageDataStore, pageDataKey, type PageDataAreaLike } from '../../src/extractors/page-data-store.ts';

function memoryArea(failing = false): PageDataAreaLike & { items: Map<string, unknown> } {
  const items = new Map<string, unknown>();
  return {
    items,
    get: (key) => (failing ? Promise.reject(new Error('storage is gone')) : Promise.resolve(items.has(key) ? { [key]: items.get(key) } : {})),
    set: (values) => {
      if (failing) {
        return Promise.reject(new Error('storage is gone'));
      }
      Object.entries(values).forEach(([key, value]) => items.set(key, value));
      return Promise.resolve();
    },
    remove: (key) => (failing ? Promise.reject(new Error('storage is gone')) : Promise.resolve(void items.delete(key))),
  };
}

describe('PageDataStore', () => {
  test('keeps the newest value per tab and variable', async () => {
    const store = new PageDataStore(memoryArea());

    await store.save(1, { name: 'ytInitialPlayerResponse', json: '"old"' });
    await store.save(1, { name: 'ytInitialPlayerResponse', json: '"new"' });
    await store.save(2, { name: 'ytInitialPlayerResponse', json: '"other tab"' });

    expect(await store.load(1, 'ytInitialPlayerResponse')).toBe('"new"');
    expect(await store.load(2, 'ytInitialPlayerResponse')).toBe('"other tab"');
    expect(await store.load(3, 'ytInitialPlayerResponse')).toBeUndefined();
  });

  test('clear forgets the value', async () => {
    const area = memoryArea();
    const store = new PageDataStore(area);
    await store.save(1, { name: 'ytInitialPlayerResponse', json: '{}' });

    await store.clear(1, 'ytInitialPlayerResponse');

    expect(area.items.has(pageDataKey(1, 'ytInitialPlayerResponse'))).toBe(false);
  });

  test('a storage that fails gives an error result and no value, not an exception', async () => {
    const store = new PageDataStore(memoryArea(true));

    expect((await store.save(1, { name: 'ytInitialPlayerResponse', json: '{}' })).ok).toBe(false);
    expect(await store.load(1, 'ytInitialPlayerResponse')).toBeUndefined();
    await expect(store.clear(1, 'ytInitialPlayerResponse')).resolves.toBeUndefined();
  });
});
