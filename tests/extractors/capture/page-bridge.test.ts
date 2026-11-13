import { describe, expect, test, vi } from 'vitest';
import { CAPTURE_CHANNEL, capturePost, parseCapturePost } from '../../../src/extractors/capture/capture-messages.ts';
import { listenForCapture, postingSink, type MessageSource, type MessageTarget } from '../../../src/extractors/capture/page-bridge.ts';
import type { CaptureEvent } from '../../../src/extractors/capture/types.ts';

const EVENTS: CaptureEvent[] = [
  { kind: 'buffer', bufferId: 1, sourceId: 1, mime: 'video/mp4; codecs="avc1.4d401e"' },
  { kind: 'append', bufferId: 1, bytes: new Uint8Array([1, 2, 3]), durationSeconds: 60 },
  { kind: 'append', bufferId: 2, bytes: new Uint8Array([4]) },
  { kind: 'eme', api: 'setMediaKeys' },
];

describe('capturePost and parseCapturePost', () => {
  test.each(EVENTS.map((event) => [event.kind, event] as const))('a %s event goes through the message and back', (_kind, event) => {
    const { message } = capturePost(event);

    expect(parseCapturePost(message)).toEqual({ ok: true, value: event });
  });

  test('an append carries its own copy of the bytes to transfer', () => {
    const bytes = new Uint8Array([9, 8, 7, 6]).subarray(1, 3);

    const { message, transfer } = capturePost({ kind: 'append', bufferId: 1, bytes });

    expect(transfer).toHaveLength(1);
    expect(transfer[0]?.byteLength).toBe(2);
    expect(message.event).toMatchObject({ kind: 'append' });
    expect(Array.from(bytes)).toEqual([8, 7]);
  });

  test.each([
    ['null', null],
    ['text', 'hello'],
    ['another channel', { channel: 'other', event: EVENTS[0] }],
    ['no event', { channel: CAPTURE_CHANNEL }],
    ['an unknown kind', { channel: CAPTURE_CHANNEL, event: { kind: 'format-disk' } }],
    ['a buffer without a mime type', { channel: CAPTURE_CHANNEL, event: { kind: 'buffer', bufferId: 1, sourceId: 1 } }],
    ['a negative buffer id', { channel: CAPTURE_CHANNEL, event: { kind: 'buffer', bufferId: -1, sourceId: 1, mime: 'video/mp4' } }],
    ['an append without bytes', { channel: CAPTURE_CHANNEL, event: { kind: 'append', bufferId: 1, bytes: 'abc' } }],
    ['an encrypted media event without a name', { channel: CAPTURE_CHANNEL, event: { kind: 'eme' } }],
  ])('refuses %s', (_name, data) => {
    expect(parseCapturePost(data).ok).toBe(false);
  });
});

describe('listenForCapture', () => {
  function createWindow() {
    let listener: ((event: { source: unknown; data: unknown }) => void) | undefined;
    const window: MessageSource = {
      addEventListener: (_type, handler) => {
        listener = handler;
      },
    };
    return { window, deliver: (event: { source: unknown; data: unknown }) => listener?.(event) };
  }

  test('hands over the events posted by the page itself', () => {
    const { window, deliver } = createWindow();
    const handle = vi.fn<(event: CaptureEvent) => void>();
    listenForCapture(window, handle);

    for (const event of EVENTS) {
      deliver({ source: window, data: capturePost(event).message });
    }

    expect(handle.mock.calls.map(([event]) => event)).toEqual(EVENTS);
  });

  test.each([
    ['a message from another window (a frame in the page)', { source: {}, data: capturePost(EVENTS[3] as CaptureEvent).message }],
    ['a message of another channel', { source: 'self', data: { channel: 'x' } }],
    ['plain text', { source: 'self', data: 'hello' }],
  ])('drops %s', (_name, event) => {
    const { window, deliver } = createWindow();
    const handle = vi.fn<(event: CaptureEvent) => void>();
    listenForCapture(window, handle);

    deliver({ ...event, source: event.source === 'self' ? window : event.source });

    expect(handle).not.toHaveBeenCalled();
  });
});

describe('postingSink', () => {
  test('posts every kind of event to the page itself, with the bytes transferred', () => {
    const posts: { message: unknown; origin: string; transfer: Transferable[] }[] = [];
    const target: MessageTarget = {
      postMessage: (message, origin, transfer) => void posts.push({ message, origin, transfer }),
      location: { origin: 'https://example.com' },
    };
    const sink = postingSink(target);

    sink.bufferAdded({ bufferId: 1, sourceId: 1, mime: 'video/mp4' });
    sink.appended({ bufferId: 1, bytes: new Uint8Array([1, 2]), durationSeconds: 9 });
    sink.encryptedMediaUsed('setMediaKeys');

    expect(posts.map((post) => post.origin)).toEqual(['https://example.com', 'https://example.com', 'https://example.com']);
    expect(posts.map((post) => post.transfer.length)).toEqual([0, 1, 0]);
    expect(posts.map((post) => (parseCapturePost(post.message) as { ok: true; value: CaptureEvent }).value.kind)).toEqual(['buffer', 'append', 'eme']);
  });
});
