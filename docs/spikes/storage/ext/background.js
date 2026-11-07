import { produce, download, produceAndDownload } from './engine.js';
const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.to !== 'background') {
    return false;
  }
  run(message).then(reply, (error) => reply({ error: String(error?.stack ?? error) }));
  return true;
});

async function run({ mode, mb, name }) {
  if (mode === 'background') {
    return produceAndDownload(mb, name);
  }
  if (mode === 'offscreen') {
    await api.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Spike: build a file in OPFS and a Blob URL for it',
    });
    const made = await api.runtime.sendMessage({ to: 'offscreen', mb, name });
    if (made.error) {
      return made;
    }
    const hand = await download(made.url, name);
    await api.offscreen.closeDocument();
    return { where: 'offscreen -> service worker', size: made.size, writeMs: made.writeMs, heapMb: made.heapMb, offscreenDownloadsApi: made.downloadsApiHere, ...hand };
  }
  return { error: 'unknown mode ' + mode };
}
