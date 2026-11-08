import { describe, expect, test, vi } from 'vitest';
import { CANCELLED_MESSAGE } from '../../src/engine/cancelled.ts';
import {
  createSegmentFetcher,
  type SegmentFetchLike,
  type SegmentResponseLike,
  type Sleep,
} from '../../src/engine/segment-fetcher.ts';

const URL_A = 'https://cdn.example.com/seg1.ts';

function respond(status: number, body: number[] = []): SegmentResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => Promise.resolve(new Uint8Array(body).buffer),
  };
}

/** Answers with the given responses in turn; a thrown value stands for a network error. */
function answering(...answers: (SegmentResponseLike | Error)[]) {
  const queue = [...answers];
  return vi.fn<SegmentFetchLike>(() => {
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error('unexpected request'));
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
}

function instantSleep() {
  return vi.fn<Sleep>(() => Promise.resolve());
}

describe('createSegmentFetcher', () => {
  test('returns the bytes and sends the cookies', async () => {
    const fetchLike = answering(respond(200, [1, 2, 3]));
    const fetchSegment = createSegmentFetcher(fetchLike, { sleep: instantSleep() });

    const result = await fetchSegment({ url: URL_A }, new AbortController().signal);

    expect(result).toEqual({ ok: true, value: new Uint8Array([1, 2, 3]) });
    expect(fetchLike).toHaveBeenCalledWith(URL_A, expect.objectContaining({ credentials: 'include', headers: {} }));
  });

  test.each([
    ['a server error', [respond(503), respond(200, [7])]],
    ['too many requests', [respond(429), respond(200, [7])]],
    ['a request timeout', [respond(408), respond(200, [7])]],
    ['a network error', [new TypeError('network'), respond(200, [7])]],
  ])('retries after %s and then succeeds', async (_name, answers) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchLike = answering(...answers);
    const sleep = instantSleep();
    const fetchSegment = createSegmentFetcher(fetchLike, { sleep });

    const result = await fetchSegment({ url: URL_A }, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(fetchLike).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['not found', 404],
    ['forbidden', 403],
    ['gone', 410],
  ])('does not retry when the server says %s', async (_name, status) => {
    const fetchLike = answering(respond(status));
    const fetchSegment = createSegmentFetcher(fetchLike, { sleep: instantSleep() });

    const result = await fetchSegment({ url: URL_A }, new AbortController().signal);

    expect(result).toEqual({ ok: false, error: `The server answered ${status}.` });
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  test('gives up after the configured retries and keeps the last reason', async () => {
    const fetchLike = answering(respond(500), respond(502), respond(503));
    const fetchSegment = createSegmentFetcher(fetchLike, { retries: 2, sleep: instantSleep() });

    const result = await fetchSegment({ url: URL_A }, new AbortController().signal);

    expect(result).toEqual({ ok: false, error: 'The server answered 503.' });
    expect(fetchLike).toHaveBeenCalledTimes(3);
  });

  test('doubles the delay up to the maximum', async () => {
    const fetchLike = answering(respond(500), respond(500), respond(500), respond(500), respond(200, [1]));
    const sleep = instantSleep();
    const fetchSegment = createSegmentFetcher(fetchLike, { retries: 4, baseDelayMs: 100, maxDelayMs: 300, sleep });

    await fetchSegment({ url: URL_A }, new AbortController().signal);

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 300, 300]);
  });

  describe('byte ranges', () => {
    const range = { offset: 10, length: 3 };

    test('asks for the part and takes a partial answer as it is', async () => {
      const fetchLike = answering(respond(206, [4, 5, 6]));
      const fetchSegment = createSegmentFetcher(fetchLike, { sleep: instantSleep() });

      const result = await fetchSegment({ url: URL_A, byteRange: range }, new AbortController().signal);

      expect(result).toEqual({ ok: true, value: new Uint8Array([4, 5, 6]) });
      expect(fetchLike).toHaveBeenCalledWith(URL_A, expect.objectContaining({ headers: { Range: 'bytes=10-12' } }));
    });

    test('cuts the part out when the server ignores the range', async () => {
      const whole = Array.from({ length: 20 }, (_unused, index) => index);
      const fetchSegment = createSegmentFetcher(answering(respond(200, whole)), { sleep: instantSleep() });

      const result = await fetchSegment({ url: URL_A, byteRange: range }, new AbortController().signal);

      expect(result).toEqual({ ok: true, value: new Uint8Array([10, 11, 12]) });
    });

    test('asks for everything from the offset on when the part has no length', async () => {
      const fetchLike = answering(respond(206, [4, 5, 6, 7]));
      const fetchSegment = createSegmentFetcher(fetchLike, { sleep: instantSleep() });

      const result = await fetchSegment({ url: URL_A, byteRange: { offset: 10 } }, new AbortController().signal);

      expect(result).toEqual({ ok: true, value: new Uint8Array([4, 5, 6, 7]) });
      expect(fetchLike).toHaveBeenCalledWith(URL_A, expect.objectContaining({ headers: { Range: 'bytes=10-' } }));
    });

    test('cuts the open-ended part out when the server ignores the range', async () => {
      const whole = Array.from({ length: 14 }, (_unused, index) => index);
      const fetchSegment = createSegmentFetcher(answering(respond(200, whole)), { sleep: instantSleep() });

      const result = await fetchSegment({ url: URL_A, byteRange: { offset: 10 } }, new AbortController().signal);

      expect(result).toEqual({ ok: true, value: new Uint8Array([10, 11, 12, 13]) });
    });

    test('retries a part that came back too short', async () => {
      const fetchLike = answering(respond(206, [4, 5]), respond(206, [4, 5, 6]));
      const fetchSegment = createSegmentFetcher(fetchLike, { sleep: instantSleep() });

      const result = await fetchSegment({ url: URL_A, byteRange: range }, new AbortController().signal);

      expect(result.ok).toBe(true);
      expect(fetchLike).toHaveBeenCalledTimes(2);
    });
  });

  describe('cancel', () => {
    test('does not fetch when already cancelled', async () => {
      const fetchLike = answering(respond(200, [1]));
      const controller = new AbortController();
      controller.abort();
      const fetchSegment = createSegmentFetcher(fetchLike, { sleep: instantSleep() });

      const result = await fetchSegment({ url: URL_A }, controller.signal);

      expect(result).toEqual({ ok: false, error: CANCELLED_MESSAGE });
      expect(fetchLike).not.toHaveBeenCalled();
    });

    test('stops a request in flight and does not retry it', async () => {
      const controller = new AbortController();
      const fetchLike = vi.fn<SegmentFetchLike>((_url, init) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      });
      const fetchSegment = createSegmentFetcher(fetchLike, { sleep: instantSleep() });

      const pending = fetchSegment({ url: URL_A }, controller.signal);
      controller.abort();

      expect(await pending).toEqual({ ok: false, error: CANCELLED_MESSAGE });
      expect(fetchLike).toHaveBeenCalledTimes(1);
    });

    test('stops waiting between attempts', async () => {
      const controller = new AbortController();
      const fetchLike = answering(respond(500), respond(200, [1]));
      const sleep = vi.fn<Sleep>(() => {
        controller.abort();
        return Promise.resolve();
      });
      const fetchSegment = createSegmentFetcher(fetchLike, { sleep });

      const result = await fetchSegment({ url: URL_A }, controller.signal);

      expect(result).toEqual({ ok: false, error: CANCELLED_MESSAGE });
      expect(fetchLike).toHaveBeenCalledTimes(1);
    });
  });

  test('retries an attempt that outlives its own timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hangThenAnswer = vi
      .fn<SegmentFetchLike>()
      .mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
        });
      })
      .mockResolvedValueOnce(respond(200, [9]));
    const fetchSegment = createSegmentFetcher(hangThenAnswer, { attemptTimeoutMs: 10, sleep: instantSleep() });

    const result = await fetchSegment({ url: URL_A }, new AbortController().signal);

    expect(result).toEqual({ ok: true, value: new Uint8Array([9]) });
    expect(hangThenAnswer).toHaveBeenCalledTimes(2);
  });
});
