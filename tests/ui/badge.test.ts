import { describe, expect, test, vi } from 'vitest';
import { tabIdFromKey } from '../../src/detect/registry.ts';
import { badgeText, BadgeController } from '../../src/ui/badge.ts';

describe('badgeText', () => {
  test.each<[number, string]>([
    [0, ''],
    [-1, ''],
    [1, '1'],
    [99, '99'],
    [100, '99+'],
  ])('%i videos show "%s"', (count, expected) => {
    expect(badgeText(count)).toBe(expected);
  });
});

describe('tabIdFromKey', () => {
  test.each<[string, number | undefined]>([
    ['streamdraft.tab.12', 12],
    ['streamdraft.tab.', undefined],
    ['streamdraft.tab.x', undefined],
    ['streamdraft.tab.1.2', undefined],
    ['settings', undefined],
  ])('%s', (key, expected) => {
    expect(tabIdFromKey(key)).toBe(expected);
  });
});

describe('BadgeController', () => {
  function create(failing = false) {
    const setBadgeText = vi.fn((details: { tabId: number; text: string }) => {
      if (failing) {
        return Promise.reject(new Error(`No tab with id ${details.tabId}`));
      }
      return Promise.resolve();
    });
    return { controller: new BadgeController({ setBadgeText }), setBadgeText };
  }

  test('shows the number of videos of the tab that changed', async () => {
    const { controller, setBadgeText } = create();

    await controller.onStorageChanged({ 'streamdraft.tab.7': { newValue: [{}, {}] } }, 'session');

    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '2' });
  });

  test('a cleared list empties the badge', async () => {
    const { controller, setBadgeText } = create();

    await controller.onStorageChanged({ 'streamdraft.tab.7': {} }, 'session');

    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '' });
  });

  test.each<[string, Record<string, { newValue?: unknown }>, string]>([
    ['another storage area', { 'streamdraft.tab.7': { newValue: [{}] } }, 'sync'],
    ['another key', { settings: { newValue: [{}] } }, 'session'],
  ])('ignores %s', async (_name, changes, area) => {
    const { controller, setBadgeText } = create();

    await controller.onStorageChanged(changes, area);

    expect(setBadgeText).not.toHaveBeenCalled();
  });

  test('a tab that is gone does not make it fail', async () => {
    const { controller } = create(true);

    await expect(controller.onStorageChanged({ 'streamdraft.tab.7': { newValue: [{}] } }, 'session')).resolves.toBeUndefined();
  });
});
