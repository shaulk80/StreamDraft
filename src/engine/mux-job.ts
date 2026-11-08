import { fail, ok, type Result } from '../core/result.ts';
import { CANCELLED_MESSAGE } from './cancelled.ts';
import { createFragmentSource, PartLoader, type FragmentSource, type MuxSource } from './fragment-sources.ts';
import { FlatMp4Writer, type FlatMp4Summary } from './mp4/flat-writer.ts';
import type { SegmentDecryptor } from './segment-decryptor.ts';
import type { SegmentStore } from './segment-store.ts';
import type { OutputSink } from './output-sink.ts';

export interface MuxProgress {
  doneSegments: number;
  totalSegments: number;
}

export interface MuxOptions {
  /** Present when any part is encrypted. */
  decryptor?: SegmentDecryptor;
  onProgress?: (progress: MuxProgress) => void;
  signal?: AbortSignal;
}

export interface MuxResult extends FlatMp4Summary {
  /** The file name extension for the output. */
  extension: 'mp4' | 'm4a';
}

/** A source being joined: where its tracks went in the output and how far it has got on the clock. */
interface OpenSource {
  source: FragmentSource;
  /** Output track id for each of the source's track ids. */
  trackIds: Map<number, number>;
  /** Timescale of each output track of the source. */
  timescales: Map<number, number>;
  /** Seconds written so far for each output track of the source. */
  trackSeconds: Map<number, number>;
  /** Seconds of the source written so far: its longest track. */
  seconds: number;
  done: boolean;
}

/** The source that is furthest behind, so the streams are written alternately in time order. */
function mostBehind(sources: readonly OpenSource[]): OpenSource | undefined {
  let behind: OpenSource | undefined;
  for (const candidate of sources) {
    if (!candidate.done && (behind === undefined || candidate.seconds < behind.seconds)) {
      behind = candidate;
    }
  }
  return behind;
}

async function openSources(sources: readonly MuxSource[], loader: PartLoader, writer: FlatMp4Writer): Promise<Result<OpenSource[]>> {
  const opened: OpenSource[] = [];
  for (const description of sources) {
    const source = createFragmentSource(description, loader);
    const tracks = await source.open();
    if (!tracks.ok) {
      source.close();
      return tracks;
    }

    const trackIds = new Map<number, number>();
    const timescales = new Map<number, number>();
    for (const track of tracks.value) {
      const id = writer.addTrack(track);
      if (!id.ok) {
        return id;
      }
      trackIds.set(track.sourceId, id.value);
      timescales.set(id.value, track.timescale);
    }
    opened.push({ source, trackIds, timescales, trackSeconds: new Map(), seconds: 0, done: false });
  }
  return ok(opened);
}

/** Writes the next segment of a source; marks the source done at its end. */
async function writeNext(entry: OpenSource, writer: FlatMp4Writer): Promise<Result<boolean>> {
  const next = await entry.source.next();
  if (!next.ok) {
    return next;
  }
  if (next.value === undefined) {
    entry.done = true;
    return ok(false);
  }

  for (const fragment of next.value) {
    const outputId = entry.trackIds.get(fragment.sourceTrackId);
    if (outputId === undefined) {
      continue;
    }

    const written = await writer.appendSamples(outputId, fragment.payload, fragment.samples, fragment.startTime);
    if (!written.ok) {
      return written;
    }

    const ticks = fragment.samples.reduce((sum, sample) => sum + sample.duration, 0);
    const total = (entry.trackSeconds.get(outputId) ?? 0) + ticks / (entry.timescales.get(outputId) ?? 1);
    entry.trackSeconds.set(outputId, total);
    entry.seconds = Math.max(entry.seconds, total);
  }
  return ok(true);
}

/**
 * Joins the downloaded segments of one or more streams (video, audio) into a
 * single flat MP4 (`.m4a` when there is only sound), read and written one
 * segment at a time. The streams are written alternately, whichever is
 * furthest behind first.
 */
export async function muxStreams(sources: readonly MuxSource[], store: SegmentStore, sink: OutputSink, options: MuxOptions = {}): Promise<Result<MuxResult>> {
  if (sources.length === 0 || sources.some((source) => source.segments.length === 0)) {
    return fail('The video has no parts to join.');
  }

  const writer = new FlatMp4Writer(sink);
  const loader = new PartLoader(store, options.decryptor);
  const opened = await openSources(sources, loader, writer);
  if (!opened.ok) {
    return opened;
  }

  const entries = opened.value;
  const progress: MuxProgress = { doneSegments: 0, totalSegments: entries.reduce((sum, entry) => sum + entry.source.segmentCount, 0) };
  try {
    for (let entry = mostBehind(entries); entry !== undefined; entry = mostBehind(entries)) {
      if (options.signal?.aborted === true) {
        return fail(CANCELLED_MESSAGE);
      }

      const written = await writeNext(entry, writer);
      if (!written.ok) {
        return written;
      }
      if (written.value) {
        progress.doneSegments++;
        options.onProgress?.({ ...progress });
      }
    }
  } finally {
    entries.forEach((entry) => entry.source.close());
  }

  const finished = await writer.finish();
  return finished.ok ? ok({ ...finished.value, extension: finished.value.audioOnly ? 'm4a' : 'mp4' }) : finished;
}
