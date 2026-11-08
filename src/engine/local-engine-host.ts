import type { Result } from '../core/result.ts';
import type { EngineHost, EngineJob } from './engine-types.ts';
import type { StreamEngine } from './stream-engine.ts';

/** Runs the engine in the page the background lives in (Firefox: the event page has a DOM and OPFS). */
export class LocalEngineHost implements EngineHost {
  constructor(private readonly engine: StreamEngine) {}

  start(job: EngineJob): Promise<Result<void>> {
    return Promise.resolve(this.engine.start(job));
  }

  cancel(jobId: string): Promise<void> {
    this.engine.cancel(jobId);
    return Promise.resolve();
  }

  release(jobId: string): Promise<void> {
    return this.engine.release(jobId);
  }
}
