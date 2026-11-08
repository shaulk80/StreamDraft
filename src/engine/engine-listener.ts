import { fail, ok, type Result } from '../core/result.ts';
import { parseEngineCommandMessage } from './engine-messages.ts';
import type { StreamEngine } from './stream-engine.ts';

/** What the listener needs of the engine. */
export type EngineControl = Pick<StreamEngine, 'start' | 'cancel' | 'release' | 'heldJobs'>;

/**
 * Answers the engine commands a message carries, for the offscreen document.
 * Returns undefined for any other message, so the other listeners can answer.
 * A message from a page's content script (it has a tab) is not ours: ignored.
 */
export function createEngineListener(
  engine: EngineControl,
): (message: unknown, sender: { tab?: unknown }) => Promise<Result<number | undefined>> | undefined {
  return (message, sender) => {
    const command = parseEngineCommandMessage(message);
    if (!command.ok || sender.tab !== undefined) {
      return undefined;
    }

    switch (command.value.kind) {
      case 'start': {
        const started = engine.start(command.value.job);
        return Promise.resolve(started.ok ? ok(undefined) : fail(started.error));
      }
      case 'cancel':
        engine.cancel(command.value.jobId);
        return Promise.resolve(ok(undefined));
      case 'release':
        return engine.release(command.value.jobId).then(() => ok(undefined));
      case 'status':
        return Promise.resolve(ok(engine.heldJobs()));
    }
  };
}
