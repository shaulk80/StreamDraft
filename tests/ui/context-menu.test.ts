import { describe, expect, test, vi } from 'vitest';
import { fail, ok, type Result } from '../../src/core/result.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings.ts';
import {
  ContextMenuController,
  MENU_ITEM_ID,
  type MenuItemProperties,
  type MenusLike,
} from '../../src/ui/context-menu.ts';

/** Records what is in the menu; each call takes a tick, so overlapping calls would interleave. */
class FakeMenus implements MenusLike {
  entries: string[] = [];
  createResult: Result<void> = ok(undefined);
  removeFails = false;

  async create(properties: MenuItemProperties): Promise<Result<void>> {
    await Promise.resolve();
    if (!this.createResult.ok) {
      return this.createResult;
    }
    this.entries.push(properties.id);
    return ok(undefined);
  }

  async removeAll(): Promise<void> {
    await Promise.resolve();
    if (this.removeFails) {
      throw new Error('menus unavailable');
    }
    this.entries = [];
  }
}

function withMenu(enabled: boolean): Settings {
  return { ...DEFAULT_SETTINGS, contextMenu: enabled };
}

function quietErrors(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

describe('ContextMenuController', () => {
  test.each([
    ['on adds the entry', true, [MENU_ITEM_ID]],
    ['off leaves no entry', false, []],
  ])('%s', async (_name, enabled, expected) => {
    const menus = new FakeMenus();

    await new ContextMenuController(menus).apply(withMenu(enabled));

    expect(menus.entries).toEqual(expected);
  });

  test('applying "on" twice still leaves one entry', async () => {
    const menus = new FakeMenus();
    const controller = new ContextMenuController(menus);

    await controller.apply(withMenu(true));
    await controller.apply(withMenu(true));

    expect(menus.entries).toEqual([MENU_ITEM_ID]);
  });

  test.each([
    ['on then off', [true, false], []],
    ['off then on', [false, true], [MENU_ITEM_ID]],
    ['quick on, off, on', [true, false, true], [MENU_ITEM_ID]],
    ['quick on, on, off', [true, true, false], []],
  ])('quick toggles without waiting: %s', async (_name, sequence, expected) => {
    const menus = new FakeMenus();
    const controller = new ContextMenuController(menus);

    await Promise.all(sequence.map((enabled) => controller.apply(withMenu(enabled))));

    expect(menus.entries).toEqual(expected);
  });

  test('a refused entry is reported and later updates still work', async () => {
    quietErrors();
    const menus = new FakeMenus();
    const controller = new ContextMenuController(menus);
    menus.createResult = fail('refused');

    await controller.apply(withMenu(true));
    expect(menus.entries).toEqual([]);

    menus.createResult = ok(undefined);
    await controller.apply(withMenu(true));
    expect(menus.entries).toEqual([MENU_ITEM_ID]);
  });

  test('a failing removeAll does not stop later updates', async () => {
    quietErrors();
    const menus = new FakeMenus();
    const controller = new ContextMenuController(menus);
    menus.removeFails = true;

    await controller.apply(withMenu(true));
    menus.removeFails = false;
    await controller.apply(withMenu(true));

    expect(menus.entries).toEqual([MENU_ITEM_ID]);
  });
});
