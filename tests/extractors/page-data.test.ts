import { describe, expect, test } from 'vitest';
import { pageDataMessage, parsePageDataMessage } from '../../src/core/messages.ts';
import {
  checkPageData,
  MAX_PAGE_DATA_CHARS,
  pageDataPost,
  PAGE_DATA_CHANNEL,
  parsePageDataPost,
} from '../../src/extractors/page-data.ts';

const cyclic: Record<string, unknown> = {};
cyclic.self = cyclic;

describe('pageDataPost', () => {
  test('a known variable becomes a message with its JSON', () => {
    expect(pageDataPost('ytInitialPlayerResponse', { a: 1 })).toEqual({
      ok: true,
      value: { channel: PAGE_DATA_CHANNEL, name: 'ytInitialPlayerResponse', json: '{"a":1}' },
    });
  });

  test.each([
    ['an unknown variable', 'somethingElse', { a: 1 }],
    ['a value that is not JSON', 'ytInitialPlayerResponse', cyclic],
    ['a value that is too large', 'ytInitialPlayerResponse', 'x'.repeat(MAX_PAGE_DATA_CHARS)],
    ['no value', 'ytInitialPlayerResponse', undefined],
  ])('%s is an error', (_name, variable, value) => {
    expect(pageDataPost(variable, value).ok).toBe(false);
  });
});

describe('parsePageDataPost', () => {
  const valid = { channel: PAGE_DATA_CHANNEL, name: 'ytInitialPlayerResponse', json: '{}' };

  test('a message of the channel gives its data', () => {
    expect(parsePageDataPost(valid)).toEqual({ ok: true, value: { name: 'ytInitialPlayerResponse', json: '{}' } });
  });

  test.each([
    ['null', null],
    ['text', 'hello'],
    ['another channel', { ...valid, channel: 'other' }],
    ['a name that is not text', { ...valid, name: 5 }],
    ['json that is not text', { ...valid, json: {} }],
    ['an unknown variable', { ...valid, name: 'secret' }],
    ['json that is too large', { ...valid, json: 'x'.repeat(MAX_PAGE_DATA_CHARS + 1) }],
  ])('%s is refused', (_name, data) => {
    expect(parsePageDataPost(data).ok).toBe(false);
  });
});

describe('checkPageData', () => {
  test.each([
    ['a known variable', { name: 'ytInitialPlayerResponse', json: '{}' }, true],
    ['an unknown variable', { name: 'other', json: '{}' }, false],
  ])('%s', (_name, data, expected) => {
    expect(checkPageData(data).ok).toBe(expected);
  });
});

describe('page-data message', () => {
  test('goes through the message and back', () => {
    const data = { name: 'ytInitialPlayerResponse', json: '{"a":1}' };
    expect(parsePageDataMessage(pageDataMessage(data))).toEqual({ ok: true, value: data });
  });

  test.each([
    ['null', null],
    ['another type', { type: 'found-media', name: 'a', json: '{}' }],
    ['a missing name', { type: 'page-data', json: '{}' }],
  ])('%s is refused', (_name, message) => {
    expect(parsePageDataMessage(message).ok).toBe(false);
  });
});
