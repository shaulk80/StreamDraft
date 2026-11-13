import { fail, ok, type Result } from '../core/result.ts';
import type { Settings } from '../core/settings.ts';
import { matchPatternsFor } from '../core/site-list.ts';

/** The id under which the page-world script (the media hook) is registered with the browser. */
export const CAPTURE_SCRIPT_ID = 'streamdraft-player-capture';

/** The id of the content script that stores what the hook sees and answers the background. */
export const CAPTURE_PAGE_SCRIPT_ID = 'streamdraft-player-capture-page';

const SCRIPT_IDS = [CAPTURE_SCRIPT_ID, CAPTURE_PAGE_SCRIPT_ID];

export interface RegisteredScript {
  id: string;
  matches?: string[];
}

export interface ScriptRegistration {
  id: string;
  js: string[];
  matches: string[];
  /** Left out for the content script's own world. */
  world?: 'MAIN';
  runAt: 'document_start';
  persistAcrossSessions: boolean;
}

/** The part of `browser.scripting` the registrar uses. */
export interface ScriptingLike {
  getRegisteredContentScripts(filter: { ids: string[] }): Promise<RegisteredScript[]>;
  registerContentScripts(scripts: ScriptRegistration[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
}

/** Paths of the built scripts inside the extension, such as `content-scripts/player-capture-main.js`. */
export interface CaptureScriptFiles {
  /** Runs in the page's own world and hooks its media pipeline. */
  main: string;
  /** Runs in the extension's world next to it; receives the hook's events. */
  page: string;
}

/**
 * The one switch for the player capture. The two scripts that watch a page's
 * player are not part of the manifest: they exist in the browser only while
 * the setting is on, and only for the sites in the list. Switched off, no
 * page gets them and no page is touched. The state is made to match the
 * settings on every start of the background and on every change, so it is
 * safe to call `apply` again and again. Pages that are already open keep what
 * they have until they are loaded again.
 */
export class CaptureRegistrar {
  constructor(
    private readonly scripting: ScriptingLike,
    private readonly files: CaptureScriptFiles,
  ) {}

  async apply(settings: Pick<Settings, 'playerCapture' | 'playerCaptureSites'>): Promise<Result<void>> {
    const wanted = settings.playerCapture ? matchPatternsFor(settings.playerCaptureSites) : [];
    try {
      const current = await this.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
      const upToDate = wanted.length > 0 && current.length === SCRIPT_IDS.length && current.every((script) => sameList(script.matches ?? [], wanted));
      if (upToDate || (wanted.length === 0 && current.length === 0)) {
        return ok(undefined);
      }

      if (current.length > 0) {
        await this.scripting.unregisterContentScripts({ ids: current.map((script) => script.id) });
      }
      if (wanted.length > 0) {
        await this.scripting.registerContentScripts([
          { id: CAPTURE_SCRIPT_ID, js: [this.files.main], matches: wanted, world: 'MAIN', runAt: 'document_start', persistAcrossSessions: true },
          { id: CAPTURE_PAGE_SCRIPT_ID, js: [this.files.page], matches: wanted, runAt: 'document_start', persistAcrossSessions: true },
        ]);
      }
      return ok(undefined);
    } catch (error) {
      console.error('StreamDraft: could not set up the player capture', error);
      return fail('The player capture could not be set up.');
    }
  }
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
