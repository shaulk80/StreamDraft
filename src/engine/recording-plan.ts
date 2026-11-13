import { fail, ok, type Result } from '../core/result.ts';
import type { MuxSource, StoredPart } from './fragment-sources.ts';
import { allParts, type RecordingBuffer, type RecordingInput } from './recording-input.ts';

/** What the muxer needs to join a recording: the same shape a fetched stream plans to. */
export interface RecordingPlan {
  sources: MuxSource[];
  soundOnly: boolean;
}

const EMPTY = 'The recording has no video to save.';
const NO_ORDER = 'A part of the recording does not say where it belongs in time.';
const DUPLICATE_PART = 'The recording lists the same part twice.';

function storedPart(part: { name: string }): StoredPart {
  return { name: part.name };
}

function sourceOf(buffer: RecordingBuffer): Result<MuxSource> {
  if (buffer.fragments.length === 0) {
    return fail(EMPTY);
  }
  if (buffer.fragments.some((part) => part.startSeconds === undefined || !Number.isFinite(part.startSeconds))) {
    return fail(NO_ORDER);
  }

  // The player may have appended the segments in any order (after a seek); the file runs in time order.
  const ordered = [...buffer.fragments].sort((first, second) => (first.startSeconds ?? 0) - (second.startSeconds ?? 0));
  return ok({ format: 'fmp4', init: storedPart(buffer.init), segments: ordered.map(storedPart) });
}

/** Sound only keeps the audio buffers when there are any; otherwise the muxer takes the sound out of the rest. */
function wantedBuffers(recording: RecordingInput, soundOnly: boolean): RecordingBuffer[] {
  const audio = recording.buffers.filter((buffer) => buffer.kind === 'audio');
  return soundOnly && audio.length > 0 ? audio : recording.buffers;
}

/** Turns a captured recording into the sources `muxStreams` joins. Nothing is fetched or read. */
export function planRecording(recording: RecordingInput, soundOnly: boolean): Result<RecordingPlan> {
  const names = allParts(recording).map((part) => part.name);
  if (recording.buffers.length === 0) {
    return fail(EMPTY);
  }
  if (new Set(names).size !== names.length) {
    return fail(DUPLICATE_PART);
  }

  const sources: MuxSource[] = [];
  for (const buffer of wantedBuffers(recording, soundOnly)) {
    const source = sourceOf(buffer);
    if (!source.ok) {
      return source;
    }
    sources.push(source.value);
  }
  return ok({ sources, soundOnly });
}
