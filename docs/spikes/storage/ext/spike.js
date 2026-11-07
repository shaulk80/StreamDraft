import { produceAndDownload } from './engine.js';
const api = globalThis.browser ?? globalThis.chrome;
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const mb = Number(params.get('mb'));
const name = `spike-${mode}-${mb}.bin`;

async function main() {
  if (mode === 'page') {
    return produceAndDownload(mb, name);
  }
  return api.runtime.sendMessage({ to: 'background', mode, mb, name });
}

main().then(
  (result) => finish({ mode, mb, name, ...result }),
  (error) => finish({ mode, mb, name, error: String(error?.stack ?? error) }),
);

async function finish(result) {
  const estimate = await navigator.storage.estimate();
  result.quotaMb = Math.round(estimate.quota / 1048576);
  document.getElementById('out').textContent = JSON.stringify(result);
  document.body.dataset.done = '1';
}
