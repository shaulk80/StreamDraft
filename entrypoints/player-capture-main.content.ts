import { consumeArm } from '../src/extractors/capture/arm-marker.ts';
import { installMediaHook, type PipelineGlobals } from '../src/extractors/capture/media-hook.ts';
import { postingSink } from '../src/extractors/capture/page-bridge.ts';
import { pageDataPost, PAGE_VARIABLES } from '../src/extractors/page-data.ts';

/** Reads the listed page variables and posts those that exist. */
function postPageVariables(): void {
  for (const name of PAGE_VARIABLES) {
    const value = (window as unknown as Record<string, unknown>)[name];
    if (value === undefined) {
      continue;
    }

    const post = pageDataPost(name, value);
    if (!post.ok) {
      console.error(`StreamDraft: ${post.error}`);
      continue;
    }
    window.postMessage(post.value, window.location.origin);
  }
}

// Runs in the MAIN world: the page's own JavaScript environment. It is not in the manifest: the background
// registers it only while the player capture is switched on and only for the sites in the settings
// (`CaptureRegistrar`), and it starts before the page's own scripts. It does nothing unless this load of the
// page was marked for recording (`armTab`, set by the popup's Record button, which then reloads the tab);
// then it watches the media pipeline of the page and posts what the player appends to the content script,
// and it tells the player that VP9, AV1 and WebM cannot be played so that it takes H.264 and AAC (decision 0010).
// The reading of PAGE_VARIABLES is left from the first spike and goes when the smoke tests no longer need it.
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    window.addEventListener('load', postPageVariables, { once: true });

    if (consumeArm(window.sessionStorage, Date.now())) {
      installMediaHook(window as unknown as PipelineGlobals, { hideCodecs: true }, postingSink(window));
    }
  },
});
