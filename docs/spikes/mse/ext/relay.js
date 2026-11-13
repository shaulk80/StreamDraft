// Isolated world content script. Relays the page's chunks to the extension page (receiver.html).
// Chrome's runtime messages are JSON; Firefox clones. A probe tells which one this browser is.
const api = globalThis.browser ?? globalThis.chrome;

let mode; // 'binary' | 'base64'

function send(message) {
  return new Promise((resolve, reject) => {
    try {
      const maybe = api.runtime.sendMessage(message, (response) => {
        const error = api.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(resolve, reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function toBase64(buffer) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([buffer]));
  });
}

async function detectMode() {
  const answer = await send({ kind: 'probe', data: new Uint8Array([1, 2, 3, 4]).buffer });
  mode = answer?.gotBinary ? 'binary' : 'base64';
  return answer;
}

let startedAt = 0;
let stage = 'full';
let relayed = 0;
let relayTotal = 0;
let pageWriter;
let pageWrites = Promise.resolve();
const PART_CHUNKS = Number(new URLSearchParams(location.search).get('part') ?? 64);
let written = 0;
let partNames = [];
window.addEventListener('message', async (event) => {
  if (event.source !== window) {
    return;
  }
  const data = event.data;
  try {
    if (data?.channel === 'spike-start') {
      const probe = await detectMode();
      startedAt = performance.now();
      stage = data.stage;
      written = 0;
      partNames = [];
      relayed = 0;
      relayTotal = data.total;
      await send({ kind: 'start', total: data.total, chunkBytes: data.chunkBytes, mode, probe, stage });
      window.postMessage({ channel: 'spike-ready' }, '*');
    } else if (data?.channel === 'spike-chunk' && stage === 'opfs') {
      // Stage 'opfs': nothing goes through extension messaging until the files are finished. The chunks arrive
      // together but are written one after the other; a new part file is started every PART_CHUNKS chunks and
      // the finished part is closed, so the browser does not hold a whole video as one open write.
      pageWrites = pageWrites.then(async () => {
        if (written % PART_CHUNKS === 0) {
          await pageWriter?.close();
          const name = `spike-page-${partNames.length}.bin`;
          partNames.push(name);
          pageWriter = await (await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })).createWritable();
        }
        await pageWriter.write(data.buffer);
        written += 1;
      });
      await pageWrites;
      relayed += 1;
      window.postMessage({ channel: 'spike-ack', seq: data.seq }, '*');
      if (relayed === relayTotal) {
        await pageWriter.close();
        pageWriter = undefined;
        const root = await navigator.storage.getDirectory();
        const files = [];
        for (const name of partNames) {
          files.push(await (await root.getFileHandle(name)).getFile());
        }
        const reply = await send({ kind: 'blob-url', parts: files.length, urls: files.map((file) => URL.createObjectURL(file)), sizes: files.map((file) => file.size), files });
        window.postMessage({ channel: 'spike-done', stats: { stage, relayMs: Math.round(performance.now() - startedAt), ...reply } }, '*');
      }
    } else if (data?.channel === 'spike-chunk' && stage === 'relay') {
      // Stage 'relay': the content script only takes the chunk and drops it.
      relayed += 1;
      window.postMessage({ channel: 'spike-ack', seq: data.seq }, '*');
      if (relayed === relayTotal) {
        window.postMessage({ channel: 'spike-done', stats: { stage, mode, relayMs: Math.round(performance.now() - startedAt) } }, '*');
      }
    } else if (data?.channel === 'spike-chunk') {
      const payload = stage === 'blob' ? new Blob([data.buffer]) : mode === 'binary' ? data.buffer : await toBase64(data.buffer);
      const bytes = new Uint8Array(data.buffer);
      const reply = await send({ kind: 'chunk', seq: data.seq, first: bytes[0], last: bytes[bytes.length - 1], length: bytes.length, mode, payload });
      window.postMessage({ channel: 'spike-ack', seq: data.seq }, '*');
      if (reply?.stats) {
        window.postMessage({ channel: 'spike-done', stats: { ...reply.stats, mode, relayMs: Math.round(performance.now() - startedAt) } }, '*');
      }
    }
  } catch (error) {
    window.postMessage({ channel: 'spike-done', stats: { error: String(error) } }, '*');
  }
});
