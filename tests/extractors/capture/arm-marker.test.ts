import { afterEach, describe, expect, test, vi } from 'vitest';
import { ARM_KEY, ARM_VALID_MS, armTab, consumeArm, type MarkerStorage } from '../../../src/extractors/capture/arm-marker.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function memoryStorage(): MarkerStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const BLOCKED: MarkerStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('the recording mark', () => {
  test('a fresh mark is taken once', () => {
    const storage = memoryStorage();

    expect(armTab(storage, 1000)).toBe(true);

    expect(consumeArm(storage, 1500)).toBe(true);
    expect(consumeArm(storage, 1600)).toBe(false);
    expect(storage.items.has(ARM_KEY)).toBe(false);
  });

  test.each([
    ['just inside the time limit', ARM_VALID_MS, true],
    ['just past the time limit', ARM_VALID_MS + 1, false],
    ['a clock that went backwards', -1, false],
  ])('a mark %s', (_name, age, expected) => {
    const storage = memoryStorage();
    armTab(storage, 10_000);

    expect(consumeArm(storage, 10_000 + age)).toBe(expected);
  });

  test('a stale mark is removed so that it cannot arm a later load', () => {
    const storage = memoryStorage();
    armTab(storage, 0);

    consumeArm(storage, ARM_VALID_MS * 2);

    expect(storage.items.size).toBe(0);
  });

  test.each([['no mark'], ['a mark that is not a number']])('%s is not armed', (name) => {
    const storage = memoryStorage();
    if (name !== 'no mark') {
      storage.items.set(ARM_KEY, 'yes please');
    }

    expect(consumeArm(storage, 1000)).toBe(false);
  });

  test('a storage that refuses is reported as not armed and not armable, not as an exception', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(armTab(BLOCKED, 1000)).toBe(false);
    expect(consumeArm(BLOCKED, 1000)).toBe(false);
  });
});
