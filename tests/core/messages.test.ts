import { describe, expect, test } from 'vitest';
import { demoDownloadMessage, handleMessage, parseDemoDownloadMessage, PING } from '../../src/core/messages.ts';

describe('handleMessage', () => {
  test('answers a ping with the start time', () => {
    const result = handleMessage({ type: PING }, 42);

    expect(result).toEqual({ ok: true, value: { startedAt: 42 } });
  });

  test.each([
    ['null', null],
    ['a string', 'ping'],
    ['a number', 7],
    ['an object without type', {}],
    ['an unknown type', { type: 'other' }],
  ])('rejects %s', (_name, message) => {
    const result = handleMessage(message, 42);

    expect(result.ok).toBe(false);
  });
});

describe('parseDemoDownloadMessage', () => {
  test('returns the text of a demo download message', () => {
    expect(parseDemoDownloadMessage(demoDownloadMessage('Saved as x.mp4'))).toEqual({
      ok: true,
      value: 'Saved as x.mp4',
    });
  });

  test.each([
    ['null', null],
    ['a string', 'show-demo-download'],
    ['a ping', { type: PING }],
    ['no text', { type: 'show-demo-download' }],
    ['a text that is not a string', { type: 'show-demo-download', text: 5 }],
  ])('rejects %s', (_name, message) => {
    expect(parseDemoDownloadMessage(message).ok).toBe(false);
  });
});
