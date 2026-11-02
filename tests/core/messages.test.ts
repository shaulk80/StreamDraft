import { describe, expect, test } from 'vitest';
import { handleMessage, PING } from '../../src/core/messages.ts';

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
