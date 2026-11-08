import { describe, expect, test, vi } from 'vitest';
import { fail, ok } from '../../src/core/result.ts';
import { CANCELLED_MESSAGE } from '../../src/engine/cancelled.ts';
import type { FetchSegment, SegmentRequest } from '../../src/engine/segment-fetcher.ts';
import { runSegmentJob, segmentName, type JobProgress } from '../../src/engine/segment-job.ts';
import { MemorySegmentStore } from './memory-store.ts';

function requests(count: number): SegmentRequest[] {
  return Array.from({ length: count }, (_unused, index) => ({ url: `https://cdn.example.com/seg${index}.ts` }));
}

/** Each segment's bytes are its index repeated `index + 1` times, so sizes differ. */
function bytesFor(request: SegmentRequest): Uint8Array {
  const index = Number(/seg(\d+)/.exec(request.url)?.[1]);
  return new Uint8Array(index + 1).fill(index);
}

const serveAll: FetchSegment = (request) => Promise.resolve(ok(bytesFor(request)));

describe('runSegmentJob', () => {
  test('stores every segment under its position and reports the totals', async () => {
    const store = new MemorySegmentStore();

    const result = await runSegmentJob(requests(5), serveAll, store);

    expect(result).toEqual({ ok: true, value: { doneSegments: 5, totalSegments: 5, bytes: 1 + 2 + 3 + 4 + 5 } });
    expect([...store.segments.keys()]).toEqual(expect.arrayContaining([0, 1, 2, 3, 4].map(segmentName)));
    expect(store.segments.get(segmentName(3))).toEqual(new Uint8Array([3, 3, 3, 3]));
  });

  test('an empty list is done at once', async () => {
    const result = await runSegmentJob([], serveAll, new MemorySegmentStore());

    expect(result).toEqual({ ok: true, value: { doneSegments: 0, totalSegments: 0, bytes: 0 } });
  });

  test('reports progress after each segment, counting up', async () => {
    const seen: JobProgress[] = [];

    await runSegmentJob(requests(3), serveAll, new MemorySegmentStore(), {
      concurrency: 1,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen).toEqual([
      { doneSegments: 1, totalSegments: 3, bytes: 1 },
      { doneSegments: 2, totalSegments: 3, bytes: 3 },
      { doneSegments: 3, totalSegments: 3, bytes: 6 },
    ]);
  });

  test.each([
    [1, 6],
    [3, 6],
    [10, 6],
  ])('with concurrency %i never has more than that many fetches running (%i segments)', async (concurrency, count) => {
    let running = 0;
    let peak = 0;
    const slowFetch: FetchSegment = async (request) => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      await Promise.resolve();
      running--;
      return ok(bytesFor(request));
    };

    await runSegmentJob(requests(count), slowFetch, new MemorySegmentStore(), { concurrency });

    expect(peak).toBe(Math.min(concurrency, count));
  });

  test('skips segments already stored and counts their bytes', async () => {
    const store = new MemorySegmentStore();
    store.segments.set(segmentName(0), new Uint8Array(10));
    store.segments.set(segmentName(2), new Uint8Array(20));
    const fetchSegment = vi.fn(serveAll);

    const result = await runSegmentJob(requests(4), fetchSegment, store);

    expect(fetchSegment).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, value: { doneSegments: 4, totalSegments: 4, bytes: 10 + 2 + 20 + 4 } });
  });

  describe('failure', () => {
    test('names the failing segment and aborts the others', async () => {
      const aborted: boolean[] = [];
      const fetchSegment: FetchSegment = async (request, signal) => {
        if (request.url.endsWith('seg1.ts')) {
          return fail('The server answered 404.');
        }
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        aborted.push(signal.aborted);
        return fail(CANCELLED_MESSAGE);
      };

      const result = await runSegmentJob(requests(4), fetchSegment, new MemorySegmentStore(), { concurrency: 3 });

      expect(result).toEqual({ ok: false, error: 'Segment 2 of 4: The server answered 404.' });
      expect(aborted).toEqual([true, true]);
    });

    test('a store that cannot write ends the job with its message', async () => {
      const store = new MemorySegmentStore();
      store.failingWrites.add(segmentName(1));

      const result = await runSegmentJob(requests(3), serveAll, store, { concurrency: 1 });

      expect(result).toEqual({
        ok: false,
        error: 'Segment 2 of 3: A part of the video could not be stored. The disk may be full.',
      });
    });

    test('keeps what was stored so a second run continues', async () => {
      const store = new MemorySegmentStore();
      let serving = true;
      const flaky: FetchSegment = (request) => {
        if (!serving && request.url.endsWith('seg2.ts')) {
          return Promise.resolve(fail('The server answered 503.'));
        }
        return Promise.resolve(ok(bytesFor(request)));
      };

      serving = false;
      const first = await runSegmentJob(requests(4), flaky, store, { concurrency: 1 });
      serving = true;
      const fetchSegment = vi.fn(flaky);
      const second = await runSegmentJob(requests(4), fetchSegment, store, { concurrency: 1 });

      expect(first.ok).toBe(false);
      expect(fetchSegment.mock.calls.map(([request]) => request.url)).toEqual([
        'https://cdn.example.com/seg2.ts',
        'https://cdn.example.com/seg3.ts',
      ]);
      expect(second.ok).toBe(true);
    });
  });

  describe('cancel', () => {
    test('is refused at once when already cancelled', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchSegment = vi.fn(serveAll);

      const result = await runSegmentJob(requests(3), fetchSegment, new MemorySegmentStore(), { signal: controller.signal });

      expect(result).toEqual({ ok: false, error: CANCELLED_MESSAGE });
      expect(fetchSegment).not.toHaveBeenCalled();
    });

    test('stops after the segment in progress and leaves the rest unfetched', async () => {
      const controller = new AbortController();
      const store = new MemorySegmentStore();
      const fetchSegment = vi.fn<FetchSegment>((request) => {
        if (request.url.endsWith('seg1.ts')) {
          controller.abort();
        }
        return Promise.resolve(ok(bytesFor(request)));
      });

      const result = await runSegmentJob(requests(6), fetchSegment, store, { concurrency: 1, signal: controller.signal });

      expect(result).toEqual({ ok: false, error: CANCELLED_MESSAGE });
      expect(fetchSegment).toHaveBeenCalledTimes(2);
    });
  });
});
