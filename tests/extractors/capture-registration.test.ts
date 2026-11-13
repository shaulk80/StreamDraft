import { describe, expect, test, vi } from 'vitest';
import {
  CAPTURE_SCRIPT_ID,
  CaptureRegistrar,
  type RegisteredScript,
  type ScriptingLike,
  type ScriptRegistration,
} from '../../src/extractors/capture-registration.ts';

const SCRIPT_FILE = 'content-scripts/player-capture-main.js';

/** A browser that keeps registered scripts in a list; `failing` makes every call fail. */
function createScripting(initial: RegisteredScript[] = [], failing = false) {
  const registered = [...initial];
  const scripting: ScriptingLike = {
    getRegisteredContentScripts: vi.fn(() =>
      failing
        ? Promise.reject(new Error('no scripting'))
        : Promise.resolve(registered.filter((script) => script.id === CAPTURE_SCRIPT_ID)),
    ),
    registerContentScripts: vi.fn((scripts: ScriptRegistration[]) => {
      registered.push(...scripts.map((script) => ({ id: script.id, matches: script.matches })));
      return Promise.resolve();
    }),
    unregisterContentScripts: vi.fn(() => {
      registered.splice(0, registered.length, ...registered.filter((script) => script.id !== CAPTURE_SCRIPT_ID));
      return Promise.resolve();
    }),
  };
  return { scripting, registered };
}

const ON = { playerCapture: true, playerCaptureSites: ['youtube.com', 'localhost'] };
const ON_PATTERNS = ['*://youtube.com/*', '*://*.youtube.com/*', '*://localhost/*'];

describe('CaptureRegistrar.apply', () => {
  test('registers the script in the page world for the listed sites when the setting is on', async () => {
    const { scripting, registered } = createScripting();

    const result = await new CaptureRegistrar(scripting, SCRIPT_FILE).apply(ON);

    expect(result.ok).toBe(true);
    expect(registered).toEqual([{ id: CAPTURE_SCRIPT_ID, matches: ON_PATTERNS }]);
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ js: [SCRIPT_FILE], world: 'MAIN', runAt: 'document_start', persistAcrossSessions: true }),
    ]);
  });

  test.each([
    ['the setting is off', { playerCapture: false, playerCaptureSites: ['youtube.com'] }],
    ['the site list is empty', { playerCapture: true, playerCaptureSites: [] }],
  ])('removes the script when %s', async (_name, settings) => {
    const { scripting, registered } = createScripting([{ id: CAPTURE_SCRIPT_ID, matches: ON_PATTERNS }]);

    const result = await new CaptureRegistrar(scripting, SCRIPT_FILE).apply(settings);

    expect(result.ok).toBe(true);
    expect(registered).toEqual([]);
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  test('registers nothing when it is off and nothing is registered', async () => {
    const { scripting } = createScripting();

    await new CaptureRegistrar(scripting, SCRIPT_FILE).apply({ playerCapture: false, playerCaptureSites: ['youtube.com'] });

    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  test('leaves a script alone that already matches the settings (the background starts often)', async () => {
    const { scripting } = createScripting([{ id: CAPTURE_SCRIPT_ID, matches: ON_PATTERNS }]);

    await new CaptureRegistrar(scripting, SCRIPT_FILE).apply(ON);

    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  test('replaces the script when the site list changed', async () => {
    const { scripting, registered } = createScripting([
      { id: CAPTURE_SCRIPT_ID, matches: ['*://old.example/*', '*://*.old.example/*'] },
    ]);

    await new CaptureRegistrar(scripting, SCRIPT_FILE).apply(ON);

    expect(registered).toEqual([{ id: CAPTURE_SCRIPT_ID, matches: ON_PATTERNS }]);
  });

  test('does not touch scripts registered under other ids', async () => {
    const { scripting, registered } = createScripting([{ id: 'other', matches: ['*://x.example/*'] }]);

    await new CaptureRegistrar(scripting, SCRIPT_FILE).apply({ playerCapture: false, playerCaptureSites: [] });

    expect(registered).toEqual([{ id: 'other', matches: ['*://x.example/*'] }]);
  });

  test('a browser that refuses gives an error result, not an exception', async () => {
    const { scripting } = createScripting([], true);

    const result = await new CaptureRegistrar(scripting, SCRIPT_FILE).apply(ON);

    expect(result.ok).toBe(false);
  });
});
