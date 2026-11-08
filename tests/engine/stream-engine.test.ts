import { describe, expect, test, vi } from 'vitest';
import type { MediaItem, QualityOption } from '../../src/core/media.ts';
import { fail, ok, type Result } from '../../src/core/result.ts';
import { CANCELLED_MESSAGE } from '../../src/engine/cancelled.ts';
import type { EngineJob, EngineSignal } from '../../src/engine/engine-types.ts';
import type { FetchSegment } from '../../src/engine/segment-fetcher.ts';
import { StreamEngine, type StreamEngineDeps } from '../../src/engine/stream-engine.ts';
import { readFlatMp4 } from './flat-mp4-reader.ts';
import { MemoryJobFiles } from './memory-job-files.ts';
import { initSegment, mediaSegment, type FixtureTrack } from './mp4-fixtures.ts';

const CDN = 'https://cdn.example.com/show';

const MANIFEST = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2S">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v1" bandwidth="800000" width="640" height="360" codecs="avc1.4d401e">
        <SegmentTemplate timescale="1000" duration="1000" startNumber="1" initialization="v1/init.mp4" media="v1/seg-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio">
      <Representation id="a1" bandwidth="64000" codecs="mp4a.40.2">
        <SegmentTemplate timescale="1000" duration="1000" startNumber="1" initialization="a1/init.mp4" media="a1/seg-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const VIDEO: FixtureTrack = { id: 1, kind: 'video', timescale: 1000 };
const AUDIO: FixtureTrack = { id: 1, kind: 'audio', timescale: 1000 };

/** What the CDN serves: an init section and two one-second segments per representation. */
function cdnFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const [folder, track] of [['v1', VIDEO], ['a1', AUDIO]] as const) {
    files.set(`${CDN}/${folder}/init.mp4`, initSegment([track]));
    [0, 1].forEach((number) => {
      const samples = [{ duration: 500, size: 10, sync: number === 0 }, { duration: 500, size: 10, sync: false }];
      files.set(`${CDN}/${folder}/seg-${number + 1}.m4s`, mediaSegment([{ trackId: 1, startTime: number * 1000, firstIndex: number * 2, samples }]));
    });
  }
  return files;
}

const ITEM: MediaItem = {
  id: `${CDN}/manifest.mpd`,
  url: `${CDN}/manifest.mpd`,
  title: 'Show',
  site: 'cdn.example.com',
  kind: 'dash',
  container: 'mp4',
  qualities: [],
  protected: false,
};
const OPTION: QualityOption = { quality: '360p', label: '360p', variant: { variantId: 'v1', height: 360 } };
const JOB: EngineJob = { jobId: 'job1', filename: 'Show [360p].mp4', item: ITEM, option: OPTION };

class Recorder {
  readonly signals: EngineSignal[] = [];
  private waiters: { matches: (signal: EngineSignal) => boolean; resolve: () => void }[] = [];

  record = (signal: EngineSignal): void => {
    this.signals.push(signal);
    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.matches(signal)) {
        waiter.resolve();
        return false;
      }
      return true;
    });
  };

  waitFor(kind: EngineSignal['kind']): Promise<void> {
    if (this.signals.some((signal) => signal.kind === kind)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push({ matches: (signal) => signal.kind === kind, resolve }));
  }

  finishedResult(): Result<{ url: string; bytes: number; filename: string }> | undefined {
    const finished = this.signals.find((signal) => signal.kind === 'finished');
    return finished?.kind === 'finished' ? finished.result : undefined;
  }
}

function setup(overrides: Partial<StreamEngineDeps> = {}, served: Map<string, Uint8Array> = cdnFiles()) {
  const files = new MemoryJobFiles();
  const recorder = new Recorder();
  const revoked: string[] = [];
  const types: string[] = [];
  const fetchSegment: FetchSegment = (request) => {
    const bytes = served.get(request.url);
    return Promise.resolve(bytes === undefined ? fail('The server answered 404.') : ok(bytes));
  };
  const engine = new StreamEngine({
    openFiles: () => Promise.resolve(ok(files)),
    fetchText: (url) => Promise.resolve(url === ITEM.url ? ok({ text: MANIFEST, url }) : fail('The stream\'s playlist could not be loaded.')),
    fetchSegment,
    createObjectUrl: (file, mimeType) => {
      types.push(mimeType);
      return `blob:test/${file.size}`;
    },
    revokeObjectUrl: (url) => revoked.push(url),
    notify: recorder.record,
    ...overrides,
  });
  return { engine, files, recorder, revoked, types };
}

describe('StreamEngine', () => {
  test('fetches, joins and offers the finished file, then removes everything on release', async () => {
    const { engine, files, recorder, revoked } = setup();

    expect(engine.start(JOB)).toEqual({ ok: true, value: undefined });
    await recorder.waitFor('finished');

    const result = recorder.finishedResult();
    expect(result?.ok).toBe(true);
    const output = files.outputs.get('output')?.bytes() ?? new Uint8Array();
    expect(result).toEqual({ ok: true, value: { jobId: 'job1', filename: 'Show [360p].mp4', url: `blob:test/${output.length}`, bytes: output.length } });
    expect(readFlatMp4(output).tracks.map((track) => track.samples.length)).toEqual([4, 4]);
    expect(engine.heldJobs()).toBe(1);

    await engine.release('job1');

    expect(revoked).toEqual([`blob:test/${output.length}`]);
    expect(files.cleared).toBe(true);
    expect(engine.heldJobs()).toBe(0);
    expect(recorder.signals.at(-1)).toEqual({ kind: 'idle' });
  });

  test.each<[string, QualityOption, string]>([
    ['a picture with sound', OPTION, 'video/mp4'],
    ['sound only', { quality: 'audio', label: 'Audio only', variant: { variantId: 'a1', audioOnly: true } }, 'audio/mp4'],
  ])('offers the file with the type of its content (%s), or the browser names it as a text file', async (_name, option, mimeType) => {
    const { engine, recorder, types } = setup();

    engine.start({ ...JOB, option });
    await recorder.waitFor('finished');

    expect(types).toEqual([mimeType]);
  });

  test('reports the total first, then each fetched part', async () => {
    const { engine, recorder } = setup();

    engine.start(JOB);
    await recorder.waitFor('finished');

    const progress = recorder.signals.flatMap((signal) => (signal.kind === 'progress' ? [signal.progress.doneSegments] : []));
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(6);
    expect(recorder.signals.find((signal) => signal.kind === 'progress')).toMatchObject({ progress: { totalSegments: 6 } });
  });

  test.each<[string, Partial<StreamEngineDeps>, Map<string, Uint8Array> | undefined, string]>([
    ['a manifest that cannot be read', { fetchText: () => Promise.resolve(fail('The stream\'s playlist could not be loaded.')) }, undefined, 'could not be loaded'],
    ['a part the server does not have', {}, new Map(), 'Segment 1 of 6'],
    ['no room for the files', { openFiles: () => Promise.resolve(fail('The browser would not give the extension space.')) }, undefined, 'space'],
  ])('ends with the reason, and nothing is left behind: %s', async (_name, overrides, served, messagePart) => {
    const { engine, files, recorder } = setup(overrides, served);

    engine.start(JOB);
    await recorder.waitFor('idle');

    const result = recorder.finishedResult();
    expect(!result?.ok && result?.error).toContain(messagePart);
    expect(engine.heldJobs()).toBe(0);
    expect(files.outputs.size).toBe(0);
  });

  test('a file that cannot be joined is dropped, not offered', async () => {
    const broken = cdnFiles();
    broken.set(`${CDN}/v1/seg-2.m4s`, new Uint8Array([1, 2, 3]));
    const { engine, files, recorder } = setup({}, broken);

    engine.start(JOB);
    await recorder.waitFor('idle');

    expect(recorder.finishedResult()?.ok).toBe(false);
    expect(files.cleared).toBe(true);
  });

  test('cancel stops the fetching and ends as cancelled', async () => {
    // Like the real fetcher: never answers until aborted, and notices a signal that is aborted already.
    const hanging: FetchSegment = (_request, signal) =>
      new Promise((resolve) => {
        if (signal.aborted) {
          resolve(fail(CANCELLED_MESSAGE));
          return;
        }
        signal.addEventListener('abort', () => resolve(fail(CANCELLED_MESSAGE)), { once: true });
      });
    const { engine, files, recorder } = setup({ fetchSegment: hanging });

    engine.start(JOB);
    await recorder.waitFor('progress');
    engine.cancel('job1');
    await recorder.waitFor('idle');

    expect(recorder.finishedResult()).toEqual({ ok: false, error: CANCELLED_MESSAGE });
    expect(files.cleared).toBe(true);
  });

  test('a job name in use is refused', () => {
    const { engine } = setup();

    engine.start(JOB);

    expect(engine.start(JOB)).toEqual({ ok: false, error: 'A download with this name is already running.' });
  });

  test('an unexpected error ends the job with a plain message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, recorder } = setup({
      openFiles: () => {
        throw new Error('boom');
      },
    });

    engine.start(JOB);
    await recorder.waitFor('idle');

    expect(recorder.finishedResult()).toEqual({ ok: false, error: 'The download stopped unexpectedly.' });
  });

  test('releasing an unknown job does nothing but announce that the engine is idle', async () => {
    const { engine, recorder, revoked } = setup();

    await engine.release('nobody');

    expect(revoked).toEqual([]);
    expect(recorder.signals).toEqual([{ kind: 'idle' }]);
  });
});
