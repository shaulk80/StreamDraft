import { fail, ok, type Result } from '../core/result.ts';
import { engineCommandMessage, type EngineCommand } from './engine-messages.ts';
import type { EngineEvent, EngineHost, EngineJob, EngineSignal } from './engine-types.ts';

/** The browser calls the offscreen host needs; the service worker has no DOM, so the engine lives in a document of its own. */
export interface OffscreenApi {
  hasDocument(): Promise<boolean>;
  createDocument(): Promise<void>;
  closeDocument(): Promise<void>;
  /** Sends a message to the document and gives its answer. */
  send(message: unknown): Promise<unknown>;
}

const UNAVAILABLE = 'The part of the extension that downloads streams is not available. Reload the extension and try again.';

interface Answer {
  ok?: unknown;
  value?: unknown;
  error?: unknown;
}

function asAnswer(value: unknown): Answer {
  return typeof value === 'object' && value !== null ? (value as Answer) : {};
}

/**
 * Runs the engine in a Chrome offscreen document. The document is created for
 * the first job and closed when it holds no job any more (closing it earlier
 * would invalidate the Blob address the download reads from).
 */
export class OffscreenEngineHost implements EngineHost {
  private opening: Promise<Result<void>> | undefined;
  /** Counts the jobs started, so a document that was just given work is not closed as idle. */
  private starts = 0;

  constructor(
    private readonly api: OffscreenApi,
    private readonly notify: (event: EngineEvent) => void,
  ) {}

  async start(job: EngineJob): Promise<Result<void>> {
    this.starts++;
    const ready = await this.ensureDocument();
    if (!ready.ok) {
      return ready;
    }
    return this.send({ kind: 'start', job });
  }

  async cancel(jobId: string): Promise<void> {
    await this.send({ kind: 'cancel', jobId });
  }

  async release(jobId: string): Promise<void> {
    await this.send({ kind: 'release', jobId });
  }

  /** Takes what the document reported: events go on to the coordinator; "idle" closes the document if it really is. */
  async receive(signal: EngineSignal): Promise<void> {
    if (signal.kind === 'idle') {
      await this.closeIfIdle();
      return;
    }
    this.notify(signal);
  }

  private async closeIfIdle(): Promise<void> {
    const startsBefore = this.starts;
    const answer = asAnswer(await this.ask({ kind: 'status' }));
    if (answer.ok !== true || answer.value !== 0 || this.starts !== startsBefore) {
      return;
    }

    try {
      await this.api.closeDocument();
    } catch (error) {
      console.error('StreamDraft: could not close the offscreen document', error);
    }
  }

  private ensureDocument(): Promise<Result<void>> {
    this.opening ??= this.open().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  private async open(): Promise<Result<void>> {
    try {
      if (!(await this.api.hasDocument())) {
        await this.api.createDocument();
      }
      return ok(undefined);
    } catch (error) {
      console.error('StreamDraft: could not open the offscreen document', error);
      return fail(UNAVAILABLE);
    }
  }

  /** Sends a command; the answer, or undefined when the document did not answer. */
  private async ask(command: EngineCommand): Promise<unknown> {
    try {
      return await this.api.send(engineCommandMessage(command));
    } catch (error) {
      console.error('StreamDraft: the offscreen document did not answer', error);
      return undefined;
    }
  }

  private async send(command: EngineCommand): Promise<Result<void>> {
    const answer = asAnswer(await this.ask(command));
    if (answer.ok === true) {
      return ok(undefined);
    }
    return fail(answer.ok === false && typeof answer.error === 'string' ? answer.error : UNAVAILABLE);
  }
}
