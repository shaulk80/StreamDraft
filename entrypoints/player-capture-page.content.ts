import { fail, ok, type Result } from '../src/core/result.ts';
import { parsePageRequestMessage, type PageRequest } from '../src/extractors/capture/capture-commands.ts';
import { PageCapture, type PartAddresses } from '../src/extractors/capture/page-capture.ts';
import { listenForCapture } from '../src/extractors/capture/page-bridge.ts';
import { OpfsPartSink, type ListableDirectory } from '../src/extractors/capture/part-store.ts';

/** Chrome cannot send a `File` in a message, so its parts are reached by `blob:` address; Firefox sends the `File`s. */
const BLOB_ADDRESSES: PartAddresses = {
  address: (file) => URL.createObjectURL(file as unknown as Blob),
  release: (address) => URL.revokeObjectURL(address),
};

function answer(capture: PageCapture, request: PageRequest): Promise<Result<unknown>> {
  switch (request) {
    case 'status':
      return capture.status().then((snapshot) => ok(snapshot));
    case 'save':
      return capture.save();
    case 'discard':
      return capture.discard().then(() => ok(undefined));
  }
}

// Runs in the extension's world, next to the page-world hook (player-capture-main.content.ts), and like it only
// where the background registered it: while the player capture is on, for the listed sites. It starts before the
// page's scripts so that it hears the first byte the hook posts. It stores what the player appends in the page's
// private file system (a folder of this page load) and answers the background's questions about it: how the
// recording stands, the finished recording, and "throw it away". A page that was not armed posts nothing, so this
// does nothing there. The files go when the page is left (decision 0010).
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  runAt: 'document_start',
  main() {
    const sink = new OpfsPartSink(
      () => navigator.storage.getDirectory() as unknown as Promise<ListableDirectory>,
      () => Date.now(),
      crypto.randomUUID(),
    );
    const capture = new PageCapture(sink, import.meta.env.FIREFOX ? undefined : BLOB_ADDRESSES);

    listenForCapture(window, (event) => capture.handle(event));

    window.addEventListener('pagehide', (event) => {
      if (!event.persisted) {
        void capture.discard();
      }
    });

    browser.runtime.onMessage.addListener((message: unknown) => {
      const request = parsePageRequestMessage(message);
      if (!request.ok) {
        return undefined;
      }
      return answer(capture, request.value).catch((error: unknown) => {
        console.error('StreamDraft: the recording script failed', error);
        return fail('The recording stopped unexpectedly. Press Record again.');
      });
    });
  },
});
