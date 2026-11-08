import { describe, expect, test } from 'vitest';
import { parseFfprobeKinds } from './ffprobe.ts';

describe('parseFfprobeKinds', () => {
  test.each([
    ['picture and sound', '{"streams":[{"codec_type":"video"},{"codec_type":"audio"}]}', ['audio', 'video']],
    ['sound only', '{"streams":[{"codec_type":"audio"}]}', ['audio']],
    ['no streams', '{"streams":[]}', []],
  ])('reads the kinds of %s', (_name, json, kinds) => {
    expect(parseFfprobeKinds(json)).toEqual({ ok: true, kinds });
  });

  test.each([
    ['text that is not JSON', 'not json'],
    ['JSON without streams', '{"format":{}}'],
    ['JSON null', 'null'],
  ])('reports %s', (_name, json) => {
    expect(parseFfprobeKinds(json).ok).toBe(false);
  });
});
