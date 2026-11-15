import { createBrowserEngine } from '../../src/engine/browser-engine.ts';
import { createEngineListener } from '../../src/engine/engine-listener.ts';
import { engineSignalMessage } from '../../src/engine/engine-messages.ts';

// The Chrome engine host (see decision 0003). It only has the `runtime` API, so
// progress and results go to the background as messages, and the background
// keeps the state.
const engine = createBrowserEngine((signal) => {
  browser.runtime.sendMessage(engineSignalMessage(signal)).catch((error: unknown) => {
    console.error('StreamDraft: the background did not take the engine signal', error);
  });
});

browser.runtime.onMessage.addListener(createEngineListener(engine));

// The document is created for a job (or, at the start of the background, to clean up after a crash) and
// closed when none is left, so a folder found now was left by a document that was closed in the middle
// of a job, or by a crash. The sweep logs its own failures; the idle news lets the background close
// a document that was opened only for it.
void engine.sweepOnStartup();
