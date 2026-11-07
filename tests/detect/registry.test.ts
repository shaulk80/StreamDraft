import { describe, expect, test } from 'vitest';
import type { MediaItem } from '../../src/core/media.ts';
import { MediaRegistry, type SessionAreaLike } from '../../src/detect/registry.ts';

class MemoryArea implements SessionAreaLike {
  data: Record<string, unknown> = {};
  failWith: Error | undefined;
  writes = 0;

  get(key: string): Promise<Record<string, unknown>> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    // Resolves later than the caller continues, like the real storage does.
    return new Promise((resolve) => {
      setTimeout(() => resolve(key in this.data ? { [key]: structuredClone(this.data[key]) } : {}), 1);
    });
  }

  set(items: Record<string, unknown>): Promise<void> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    this.writes += 1;
    Object.assign(this.data, structuredClone(items));
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    Reflect.deleteProperty(this.data, key);
    return Promise.resolve();
  }
}

function item(id: string, sizeBytes?: number): MediaItem {
  return {
    id,
    url: id,
    title: id,
    site: 'example.com',
    kind: 'direct',
    container: 'mp4',
    qualities: [{ quality: 'best', label: 'MP4', sizeBytes }],
    protected: false,
  };
}

const ids = (items: readonly MediaItem[]): string[] => items.map((entry) => entry.id);

describe('MediaRegistry', () => {
  test('an unknown tab has no videos', async () => {
    expect(await new MediaRegistry(new MemoryArea()).list(1)).toEqual([]);
  });

  test('tabs are kept apart', async () => {
    const registry = new MediaRegistry(new MemoryArea());

    await registry.add(1, item('a'));
    await registry.add(2, item('b'));

    expect(ids(await registry.list(1))).toEqual(['a']);
    expect(ids(await registry.list(2))).toEqual(['b']);
  });

  test('the same address twice is one item that learns its size', async () => {
    const registry = new MediaRegistry(new MemoryArea());

    await registry.add(1, item('a'));
    const result = await registry.add(1, item('a', 700));

    expect(result.ok && result.value).toHaveLength(1);
    expect((await registry.list(1))[0]?.qualities[0]?.sizeBytes).toBe(700);
  });

  test('an item already known is not written again', async () => {
    const area = new MemoryArea();
    const registry = new MediaRegistry(area);

    await registry.add(1, item('a', 700));
    await registry.add(1, item('a', 700));

    expect(area.writes).toBe(1);
  });

  test('items found at the same moment are all kept', async () => {
    const registry = new MediaRegistry(new MemoryArea());

    await Promise.all([registry.add(1, item('a')), registry.add(1, item('b')), registry.add(1, item('c'))]);

    expect(ids(await registry.list(1)).sort()).toEqual(['a', 'b', 'c']);
  });

  test('the oldest items go when the tab is over the limit', async () => {
    const registry = new MediaRegistry(new MemoryArea(), 2);

    await registry.add(1, item('a'));
    await registry.add(1, item('b'));
    await registry.add(1, item('c'));

    expect(ids(await registry.list(1))).toEqual(['b', 'c']);
  });

  test('retitle names every video of the tab after the page, other tabs are untouched', async () => {
    const registry = new MediaRegistry(new MemoryArea());
    await registry.add(1, item('a'));
    await registry.add(1, item('b'));
    await registry.add(2, item('c'));

    const result = await registry.retitle(1, '  The page  ');

    expect(result.ok && result.value.map((entry) => entry.title)).toEqual(['The page', 'The page']);
    expect((await registry.list(2))[0]?.title).toBe('c');
  });

  test.each<[string, string]>([
    ['the title is already the same', 'a'],
    ['the title is blank', '   '],
  ])('retitle writes nothing when %s', async (_name, title) => {
    const area = new MemoryArea();
    const registry = new MediaRegistry(area);
    await registry.add(1, item('a'));
    const writesBefore = area.writes;

    await registry.retitle(1, title);

    expect(area.writes).toBe(writesBefore);
  });

  test('retitle of a tab without videos writes nothing', async () => {
    const area = new MemoryArea();

    await new MediaRegistry(area).retitle(9, 'The page');

    expect(area.writes).toBe(0);
  });

  test('retitle reports a storage failure instead of throwing', async () => {
    const area = new MemoryArea();
    const registry = new MediaRegistry(area);
    area.failWith = new Error('quota');

    expect((await registry.retitle(1, 'The page')).ok).toBe(false);
  });

  test('clear forgets one tab only', async () => {
    const registry = new MediaRegistry(new MemoryArea());
    await registry.add(1, item('a'));
    await registry.add(2, item('b'));

    const result = await registry.clear(1);

    expect(result.ok).toBe(true);
    expect(await registry.list(1)).toEqual([]);
    expect(ids(await registry.list(2))).toEqual(['b']);
  });

  test.each<[string, unknown, string[]]>([
    ['not a list', 'garbage', []],
    ['entries of the wrong shape are dropped', [{ id: 1 }, null, item('ok')], ['ok']],
  ])('stored data that is %s', async (_name, stored, expected) => {
    const area = new MemoryArea();
    area.data['streamdraft.tab.1'] = stored;

    expect(ids(await new MediaRegistry(area).list(1))).toEqual(expected);
  });

  test('a storage failure is reported, not thrown, and later calls still work', async () => {
    const area = new MemoryArea();
    const registry = new MediaRegistry(area);
    area.failWith = new Error('quota');

    const added = await registry.add(1, item('a'));
    const cleared = await registry.clear(1);
    const listed = await registry.list(1);
    area.failWith = undefined;
    const addedAgain = await registry.add(1, item('b'));

    expect(added.ok).toBe(false);
    expect(cleared.ok).toBe(false);
    expect(listed).toEqual([]);
    expect(addedAgain.ok).toBe(true);
  });
});
