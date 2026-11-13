import { fail, ok, type Result } from '../core/result.ts';
import type { EngineJob, EngineSignal, FinishedFile } from './engine-types.ts';
import type { RecordingBuffer, RecordingInput, RecordingPart } from './recording-input.ts';
import type { JobProgress } from './segment-job.ts';

/** Background to offscreen document: a command for the engine. */
export const ENGINE_COMMAND = 'engine-command';

/** Offscreen document to background: progress, the end of a job, or "nothing left to hold". */
export const ENGINE_SIGNAL = 'engine-signal';

export type EngineCommand =
  | { kind: 'start'; job: EngineJob }
  | { kind: 'cancel'; jobId: string }
  | { kind: 'release'; jobId: string }
  /** Asks how many jobs the engine holds; the answer is a `Result<number>`. */
  | { kind: 'status' };

export function engineCommandMessage(command: EngineCommand): { type: typeof ENGINE_COMMAND; command: EngineCommand } {
  return { type: ENGINE_COMMAND, command };
}

export function engineSignalMessage(signal: EngineSignal): { type: typeof ENGINE_SIGNAL; signal: EngineSignal } {
  return { type: ENGINE_SIGNAL, signal };
}

type Fields = Record<string, unknown>;

function asObject(value: unknown): Fields | undefined {
  return typeof value === 'object' && value !== null ? (value as Fields) : undefined;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A part of a recording as a message carries it: a name and a `blob:` address (a `File` cannot travel). */
function readPart(value: unknown): RecordingPart | undefined {
  const part = asObject(value);
  if (!isText(part?.name) || !isText(part.url)) {
    return undefined;
  }
  const hasStart = part.startSeconds !== undefined;
  if (hasStart && !isCount(part.startSeconds)) {
    return undefined;
  }
  return { name: part.name, url: part.url, startSeconds: hasStart ? (part.startSeconds as number) : undefined };
}

function readBuffer(value: unknown): RecordingBuffer | undefined {
  const buffer = asObject(value);
  const init = readPart(buffer?.init);
  const fragments = Array.isArray(buffer?.fragments) ? buffer.fragments.map(readPart) : [];
  const kindKnown = buffer?.kind === 'video' || buffer?.kind === 'audio' || buffer?.kind === 'unknown';
  if (!kindKnown || init === undefined || fragments.some((part) => part === undefined)) {
    return undefined;
  }
  return { kind: buffer.kind as RecordingBuffer['kind'], init, fragments: fragments as RecordingPart[] };
}

function readRecording(value: unknown): RecordingInput | undefined {
  const buffers = Array.isArray(asObject(value)?.buffers) ? (asObject(value)?.buffers as unknown[]).map(readBuffer) : [];
  if (buffers.length === 0 || buffers.some((buffer) => buffer === undefined)) {
    return undefined;
  }
  return { buffers: buffers as RecordingBuffer[] };
}

/** A stream job names the rendition to fetch; a capture job carries the recording to join. */
function hasWhatToDownload(job: Fields, item: Fields, variant: Fields | undefined): boolean {
  if (item.kind === 'capture') {
    return readRecording(job.recording) !== undefined;
  }
  return (item.kind === 'hls' || item.kind === 'dash') && job.recording === undefined && isText(variant?.variantId);
}

/** The job of a start command, when it has the parts the engine reads. */
function readJob(value: unknown): EngineJob | undefined {
  const job = asObject(value);
  const item = asObject(job?.item);
  const option = asObject(job?.option);
  const variant = asObject(option?.variant);
  const valid =
    job !== undefined &&
    item !== undefined &&
    isText(job.jobId) &&
    isText(job.filename) &&
    isText(item.id) &&
    isText(item.url) &&
    typeof item.title === 'string' &&
    typeof item.protected === 'boolean' &&
    typeof option?.quality === 'string' &&
    hasWhatToDownload(job, item, variant);
  if (!valid) {
    return undefined;
  }

  const recording = readRecording(job.recording);
  return recording === undefined ? (job as unknown as EngineJob) : ({ ...job, recording } as unknown as EngineJob);
}

export function parseEngineCommandMessage(message: unknown): Result<EngineCommand> {
  const body = asObject(message);
  const command = asObject(body?.command);
  if (body?.type !== ENGINE_COMMAND || command === undefined) {
    return fail('Not an engine command.');
  }

  if (command.kind === 'status') {
    return ok({ kind: 'status' });
  }
  if (command.kind === 'start') {
    const job = readJob(command.job);
    return job === undefined ? fail('The engine command names no valid job.') : ok({ kind: 'start', job });
  }
  if ((command.kind === 'cancel' || command.kind === 'release') && isText(command.jobId)) {
    return ok({ kind: command.kind, jobId: command.jobId });
  }
  return fail('The engine command is not understood.');
}

function readProgress(value: unknown): JobProgress | undefined {
  const progress = asObject(value);
  if (isCount(progress?.doneSegments) && isCount(progress.totalSegments) && isCount(progress.bytes)) {
    return { doneSegments: progress.doneSegments, totalSegments: progress.totalSegments, bytes: progress.bytes };
  }
  return undefined;
}

function readFinished(jobId: string, value: unknown): Result<FinishedFile> | undefined {
  const result = asObject(value);
  if (result?.ok === false && typeof result.error === 'string') {
    return fail(result.error);
  }

  const file = asObject(result?.value);
  if (result?.ok === true && isText(file?.jobId) && isText(file.filename) && isText(file.url) && isCount(file.bytes) && file.jobId === jobId) {
    return ok({ jobId, filename: file.filename, url: file.url, bytes: file.bytes });
  }
  return undefined;
}

export function parseEngineSignalMessage(message: unknown): Result<EngineSignal> {
  const body = asObject(message);
  const signal = asObject(body?.signal);
  if (body?.type !== ENGINE_SIGNAL || signal === undefined) {
    return fail('Not an engine signal.');
  }

  if (signal.kind === 'idle') {
    return ok({ kind: 'idle' });
  }
  if (!isText(signal.jobId)) {
    return fail('The engine signal names no job.');
  }

  if (signal.kind === 'progress') {
    const progress = readProgress(signal.progress);
    return progress === undefined ? fail('The engine progress is not valid.') : ok({ kind: 'progress', jobId: signal.jobId, progress });
  }
  if (signal.kind === 'finished') {
    const result = readFinished(signal.jobId, signal.result);
    return result === undefined ? fail('The engine result is not valid.') : ok({ kind: 'finished', jobId: signal.jobId, result });
  }
  return fail('The engine signal is not understood.');
}
