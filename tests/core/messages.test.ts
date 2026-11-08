import { describe, expect, test } from 'vitest';
import {
  cancelJobMessage,
  foundMediaMessage,
  handleMessage,
  MAX_CANDIDATES_PER_MESSAGE,
  parseShowTextMessage,
  showTextMessage,
  parseFoundMediaMessage,
  parseCancelJobMessage,
  parseResolveStreamsMessage,
  resolveStreamsMessage,
  PING,
} from '../../src/core/messages.ts';

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

describe('parseShowTextMessage', () => {
  test('returns the text of a show-text message', () => {
    expect(parseShowTextMessage(showTextMessage('Saved as x.mp4'))).toEqual({
      ok: true,
      value: 'Saved as x.mp4',
    });
  });

  test.each([
    ['null', null],
    ['a string', 'show-text'],
    ['a ping', { type: PING }],
    ['no text', { type: 'show-text' }],
    ['a text that is not a string', { type: 'show-text', text: 5 }],
  ])('rejects %s', (_name, message) => {
    expect(parseShowTextMessage(message).ok).toBe(false);
  });
});

describe('parseFoundMediaMessage', () => {
  test('returns the candidates of a found-media message', () => {
    const message = foundMediaMessage([
      { url: 'https://example.com/a.mp4', contentType: 'video/mp4', pageUrl: 'https://example.com/', pageTitle: 'A' },
    ]);

    expect(parseFoundMediaMessage(message)).toEqual({
      ok: true,
      value: [{ url: 'https://example.com/a.mp4', contentType: 'video/mp4', pageUrl: 'https://example.com/', pageTitle: 'A' }],
    });
  });

  test('takes over known text fields only, never a size', () => {
    const message = { type: 'found-media', candidates: [{ url: 'https://example.com/a.mp4', sizeBytes: 1, extra: 'x', pageTitle: 7 }] };

    expect(parseFoundMediaMessage(message)).toEqual({ ok: true, value: [{ url: 'https://example.com/a.mp4' }] });
  });

  test('entries without an address are dropped', () => {
    const message = { type: 'found-media', candidates: [null, 'text', {}, { url: 5 }, { url: 'https://example.com/a.mp4' }] };

    expect(parseFoundMediaMessage(message)).toEqual({ ok: true, value: [{ url: 'https://example.com/a.mp4' }] });
  });

  test('an oversized list is cut', () => {
    const candidates = Array.from({ length: MAX_CANDIDATES_PER_MESSAGE + 10 }, (_, index) => ({
      url: `https://example.com/${index}.mp4`,
    }));

    const result = parseFoundMediaMessage({ type: 'found-media', candidates });

    expect(result.ok && result.value).toHaveLength(MAX_CANDIDATES_PER_MESSAGE);
  });

  test.each([
    ['null', null],
    ['a string', 'found-media'],
    ['a ping', { type: PING }],
    ['no list', { type: 'found-media' }],
    ['a list that is not a list', { type: 'found-media', candidates: 'x' }],
  ])('rejects %s', (_name, message) => {
    expect(parseFoundMediaMessage(message).ok).toBe(false);
  });
});

describe('parseResolveStreamsMessage', () => {
  test('returns the tab of a resolve-streams message', () => {
    expect(parseResolveStreamsMessage(resolveStreamsMessage(7))).toEqual({ ok: true, value: 7 });
  });

  test.each([
    ['not an object', 'resolve-streams'],
    ['another type', { type: 'ping', tabId: 7 }],
    ['no tab', { type: 'resolve-streams' }],
    ['a tab that is not a whole number', { type: 'resolve-streams', tabId: 1.5 }],
    ['a tab that is text', { type: 'resolve-streams', tabId: '7' }],
  ])('rejects %s', (_name, message) => {
    expect(parseResolveStreamsMessage(message).ok).toBe(false);
  });
});

describe('parseCancelJobMessage', () => {
  test('returns the job of a cancel-job message', () => {
    expect(parseCancelJobMessage(cancelJobMessage('job-1'))).toEqual({ ok: true, value: 'job-1' });
  });

  test.each([
    ['not an object', 'cancel-job'],
    ['another type', { type: 'ping', jobId: 'job-1' }],
    ['no job', { type: 'cancel-job' }],
    ['an empty job', { type: 'cancel-job', jobId: '' }],
    ['a job that is a number', { type: 'cancel-job', jobId: 4 }],
  ])('rejects %s', (_name, message) => {
    expect(parseCancelJobMessage(message).ok).toBe(false);
  });
});
