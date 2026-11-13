import { fail, ok, type Result } from '../core/result.ts';
import type { Settings } from '../core/settings.ts';
import { matchPatternsFor } from '../core/site-list.ts';

/** The id under which the player capture script is registered with the browser. */
export const CAPTURE_SCRIPT_ID = 'streamdraft-player-capture';

export interface RegisteredScript {
  id: string;
  matches?: string[];
}

export interface ScriptRegistration {
  id: string;
  js: string[];
  matches: string[];
  world: 'MAIN';
  runAt: 'document_start';
  persistAcrossSessions: boolean;
}

/** The part of `browser.scripting` the registrar uses. */
export interface ScriptingLike {
  getRegisteredContentScripts(filter: { ids: string[] }): Promise<RegisteredScript[]>;
  registerContentScripts(scripts: ScriptRegistration[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
}

/**
 * The one switch for the player capture. The script that watches a page's
 * player is not part of the manifest: it exists in the browser only while the
 * setting is on, and only for the sites in the list. Switched off, no page
 * gets it and no page is touched. The state is made to match the settings on
 * every start of the background and on every change, so it is safe to call
 * `apply` again and again. Pages that are already open keep what they have
 * until they are loaded again.
 */
export class CaptureRegistrar {
  constructor(
    private readonly scripting: ScriptingLike,
    /** Path of the built script inside the extension, such as `content-scripts/player-capture-main.js`. */
    private readonly scriptFile: string,
  ) {}

  async apply(settings: Pick<Settings, 'playerCapture' | 'playerCaptureSites'>): Promise<Result<void>> {
    const wanted = settings.playerCapture ? matchPatternsFor(settings.playerCaptureSites) : [];
    try {
      const [current] = await this.scripting.getRegisteredContentScripts({ ids: [CAPTURE_SCRIPT_ID] });
      if (current !== undefined && sameList(current.matches ?? [], wanted)) {
        return ok(undefined);
      }
      if (current !== undefined) {
        await this.scripting.unregisterContentScripts({ ids: [CAPTURE_SCRIPT_ID] });
      }
      if (wanted.length > 0) {
        await this.scripting.registerContentScripts([
          {
            id: CAPTURE_SCRIPT_ID,
            js: [this.scriptFile],
            matches: wanted,
            world: 'MAIN',
            runAt: 'document_start',
            persistAcrossSessions: true,
          },
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
