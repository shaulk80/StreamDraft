// Spike code (throwaway): write a deterministic file of `mb` MiB to OPFS in chunks, expose it as a Blob URL.
const CHUNK = 8 * 1024 * 1024;
const api = globalThis.browser ?? globalThis.chrome;

export async function produce(mb, name) {
  const started = performance.now();
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  const total = mb * 1024 * 1024;
  const chunk = new Uint8Array(CHUNK);
  let written = 0;
  let index = 0;
  while (written < total) {
    const size = Math.min(CHUNK, total - written);
    for (let i = 0; i < size; i += 1) {
      chunk[i] = (i + index) & 255;
    }
    await writable.write(size === CHUNK ? chunk : chunk.subarray(0, size));
    written += size;
    index += 1;
  }
  await writable.close();
  const file = await handle.getFile();
  const url = URL.createObjectURL(file);
  return { url, size: file.size, writeMs: Math.round(performance.now() - started), heapMb: heapMb() };
}

export function heapMb() {
  return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
}

export async function removeFile(name) {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(name);
}

export function download(url, filename) {
  return new Promise((resolve) => {
    let id;
    const listener = (delta) => {
      if (delta.id !== id || !delta.state) {
        return;
      }
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        api.downloads.onChanged.removeListener(listener);
        resolve({ state: delta.state.current, error: delta.error?.current ?? null });
      }
    };
    api.downloads.onChanged.addListener(listener);
    Promise.resolve(api.downloads.download({ url, filename, conflictAction: 'overwrite' }))
      .then((value) => {
        id = value;
      })
      .catch((error) => {
        api.downloads.onChanged.removeListener(listener);
        resolve({ state: 'refused', error: String(error) });
      });
  });
}

/** Produce in this context, then download from this context. */
export async function produceAndDownload(mb, name) {
  const made = await produce(mb, name);
  const hand = await download(made.url, name);
  return { where: 'same context', size: made.size, writeMs: made.writeMs, heapMb: made.heapMb, ...hand };
}
