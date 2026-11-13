import { describe, expect, test, vi } from 'vitest';
import {
  CAPTURE_PAGE_SCRIPT_ID,
  CAPTURE_SCRIPT_ID,
  CaptureRegistrar,
  type RegisteredScript,
  type ScriptingLike,
  type ScriptRegistration,
} from '../../src/extractors/capture-registration.ts';

const FILES = { main: 'content-scripts/player-capture-main.js', page: 'content-scripts/player-capture-page.js' };
const OURS = [CAPTURE_SCRIPT_ID, CAPTURE_PAGE_SCRIPT_ID];

/** A browser that keeps registered scripts in a list; `failing` makes every call fail. */
function createScripting(initial: RegisteredScript[] = [], failing = false) {
  const registered = [...initial];
  const scripting: ScriptingLike = {
    getRegisteredContentScripts: vi.fn((filter: { ids: string[] }) =>
      failing ? Promise.reject(new Error('no scripting')) : Promise.resolve(registered.filter((script) => filter.ids.includes(script.id))),
    ),
    registerContentScripts: vi.fn((scripts: ScriptRegistration[]) => {
      registered.push(...scripts.map((script) => ({ id: script.id, matches: script.matches })));
      return Promise.resolve();
    }),
    unregisterContentScripts: vi.fn((filter: { ids: string[] }) => {
      registered.splice(0, registered.length, ...registered.filter((script) => !filter.ids.includes(script.id)));
      return Promise.resolve();
    }),
  };
  return { scripting, registered };
}

const ON = { playerCapture: true, playerCaptureSites: ['youtube.com', 'localhost'] };
const ON_PATTERNS = ['*://youtube.com/*', '*://*.youtube.com/*', '*://localhost/*'];
const REGISTERED_ON: RegisteredScript[] = OURS.map((id) => ({ id, matches: ON_PATTERNS }));

describe('CaptureRegistrar.apply', () => {
  test('registers the hook in the page world and the recording script beside it, for the listed sites, when the setting is on', async () => {
    const { scripting, registered } = createScripting();

    const result = await new CaptureRegistrar(scripting, FILES).apply(ON);

    expect(result.ok).toBe(true);
    expect(registered).toEqual(REGISTERED_ON);
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ id: CAPTURE_SCRIPT_ID, js: [FILES.main], world: 'MAIN', runAt: 'document_start', persistAcrossSessions: true }),
      expect.objectContaining({ id: CAPTURE_PAGE_SCRIPT_ID, js: [FILES.page], runAt: 'document_start', persistAcrossSessions: true }),
    ]);
    const [scripts] = vi.mocked(scripting.registerContentScripts).mock.calls[0] ?? [[]];
    expect(scripts?.[1]?.world).toBeUndefined();
  });

  test.each([
    ['the setting is off', { playerCapture: false, playerCaptureSites: ['youtube.com'] }],
    ['the site list is empty', { playerCapture: true, playerCaptureSites: [] }],
  ])('removes both scripts when %s', async (_name, settings) => {
    const { scripting, registered } = createScripting(REGISTERED_ON);

    const result = await new CaptureRegistrar(scripting, FILES).apply(settings);

    expect(result.ok).toBe(true);
    expect(registered).toEqual([]);
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  test('registers nothing when it is off and nothing is registered', async () => {
    const { scripting } = createScripting();

    await new CaptureRegistrar(scripting, FILES).apply({ playerCapture: false, playerCaptureSites: ['youtube.com'] });

    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  test('leaves scripts alone that already match the settings (the background starts often)', async () => {
    const { scripting } = createScripting(REGISTERED_ON);

    await new CaptureRegistrar(scripting, FILES).apply(ON);

    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  test.each<[string, RegisteredScript[]]>([
    ['the site list changed', OURS.map((id) => ({ id, matches: ['*://old.example/*', '*://*.old.example/*'] }))],
    ['only the hook is registered (an older version of the extension)', [{ id: CAPTURE_SCRIPT_ID, matches: ON_PATTERNS }]],
  ])('replaces the scripts when %s', async (_name, initial) => {
    const { scripting, registered } = createScripting(initial);

    await new CaptureRegistrar(scripting, FILES).apply(ON);

    expect(registered).toEqual(REGISTERED_ON);
  });

  test('does not touch scripts registered under other ids', async () => {
    const { scripting, registered } = createScripting([{ id: 'other', matches: ['*://x.example/*'] }]);

    await new CaptureRegistrar(scripting, FILES).apply({ playerCapture: false, playerCaptureSites: [] });

    expect(registered).toEqual([{ id: 'other', matches: ['*://x.example/*'] }]);
  });

  test('a browser that refuses gives an error result, not an exception', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { scripting } = createScripting([], true);

    const result = await new CaptureRegistrar(scripting, FILES).apply(ON);

    expect(result.ok).toBe(false);
  });
});
