import { handleMessage } from '../src/core/messages.ts';

export default defineBackground(() => {
  const startedAt = Date.now();

  browser.runtime.onMessage.addListener((message: unknown) => {
    return Promise.resolve(handleMessage(message, startedAt));
  });
});
