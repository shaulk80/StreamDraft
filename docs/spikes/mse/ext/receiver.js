// Extension page standing in for the engine host (Firefox background page, Chrome offscreen document).
// Takes the chunks, writes them to OPFS and checks them.
const api = globalThis.browser ?? globalThis.chrome;

let writer;
let stage = 'full';
let total = 0;
let received = 0;
let bad = 0;
let bytes = 0;
let startedAt = 0;
let writeChain = Promise.resolve();

async function decode(message) {
  if (message.payload instanceof Blob) {
    return new Uint8Array(await message.payload.arrayBuffer());
  }
  if (message.mode === 'binary') {
    return new Uint8Array(message.payload);
  }
  const response = await fetch(`data:application/octet-stream;base64,${message.payload}`);
  return new Uint8Array(await response.arrayBuffer());
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.kind === 'probe') {
    const data = message.data;
    sendResponse({ gotBinary: data instanceof ArrayBuffer && data.byteLength === 4, type: Object.prototype.toString.call(data) });
    return false;
  }

  if (message?.kind === 'blob-url') {
    (async () => {
      const startedAtFetch = performance.now();
      // Firefox clones the Files themselves (they stay on disk); Chrome sends JSON, so the parts are fetched by blob address.
      const viaFile = Array.isArray(message.files) && message.files[0] instanceof Blob;
      let counted = 0;
      for (let index = 0; index < message.parts; index += 1) {
        const source = viaFile ? message.files[index].stream() : (await fetch(message.urls[index])).body;
        const reader = source.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          counted += value.length;
        }
      }
      const expected = message.sizes.reduce((sum, size) => sum + size, 0);
      sendResponse({ via: viaFile ? 'file clone' : 'blob url fetch', parts: message.parts, fetchedBytes: counted, expected, fetchMs: Math.round(performance.now() - startedAtFetch) });
    })().catch((error) => sendResponse({ fetchError: String(error) }));
    return true;
  }
  if (message?.kind === 'start') {
    (async () => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('spike-capture.bin', { create: true });
      writer = await handle.createWritable();
      total = message.total;
      stage = message.stage;
      received = 0;
      bad = 0;
      bytes = 0;
      startedAt = performance.now();
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message?.kind === 'chunk') {
    (async () => {
      const data = await decode(message);
      if (data.length !== message.length || data[0] !== message.first || data[data.length - 1] !== message.last) {
        bad += 1;
      }
      bytes += data.length;
      received += 1;
      // Writes keep their order even when chunks finish decoding out of order: the content is checked, not the order.
      if (stage !== 'nowrite' && stage !== 'blobnowrite') {
        writeChain = writeChain.then(() => writer.write(data));
        await writeChain;
      }
      if (received === total) {
        await writer.close();
        sendResponse({ stats: { total, bytes, bad, receiverMs: Math.round(performance.now() - startedAt) } });
        return;
      }
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ error: String(error) }));
    return true;
  }
  return false;
});
