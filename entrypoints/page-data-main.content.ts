import { pageDataPost, PAGE_VARIABLES } from '../src/extractors/page-data.ts';

// Runs in the MAIN world: the page's own JavaScript environment, where the page's variables are visible.
// It only reads the variables listed in PAGE_VARIABLES and posts them; it changes nothing in the page.
// Matches are the sites that have an extractor, plus the local test page (tests/pages/main-world.html).
export default defineContentScript({
  matches: ['*://*.youtube.com/*', 'http://127.0.0.1/main-world.html*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
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
  },
});
