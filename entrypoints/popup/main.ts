import { PING, type PongPayload } from '../../src/core/messages.ts';
import type { Result } from '../../src/core/result.ts';

async function showBackgroundStatus(statusElement: HTMLElement): Promise<void> {
  try {
    const reply = (await browser.runtime.sendMessage({ type: PING })) as Result<PongPayload>;
    if (reply.ok) {
      statusElement.textContent = 'Background: ready';
      return;
    }
    statusElement.textContent = `Background: error (${reply.error})`;
  } catch (error) {
    console.error('StreamDraft: background did not answer', error);
    statusElement.textContent = 'Background: not responding';
  }
}

const statusElement = document.getElementById('status');
if (statusElement) {
  void showBackgroundStatus(statusElement);
}
