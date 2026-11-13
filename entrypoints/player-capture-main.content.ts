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

// Runs in the MAIN world: the page's own JavaScript environment, where the page's variables are visible.
// It is not in the manifest: the background registers it only while the player capture is switched on
// and only for the sites in the settings (`CaptureRegistrar`). It starts before the page's own scripts
// (the player hook of M4 must), so the variables are read once the page has loaded. For now it only
// posts the variables listed in PAGE_VARIABLES; the player hook takes its place here.
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    window.addEventListener('load', postPageVariables, { once: true });
  },
});
