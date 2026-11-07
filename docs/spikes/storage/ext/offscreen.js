import { produce, heapMb } from './engine.js';
const api = globalThis.chrome;
api.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.to !== 'offscreen') {
    return false;
  }
  produce(message.mb, message.name).then(
    (made) => reply({ ...made, downloadsApiHere: typeof api.downloads }),
    (error) => reply({ error: String(error) }),
  );
  return true;
});
