import { describe, expect, test } from 'vitest';
import { ascii, box, concatBytes, u32 } from '../../../src/engine/mp4/bytes.ts';
import { DAMAGED_STREAM, SegmentAssembler, type AssembledPart } from '../../../src/extractors/capture/segment-assembler.ts';
import { chunked, secondSegment, trackStream, VIDEO_TRACK } from './stream-fixtures.ts';

function feed(chunks: readonly Uint8Array[]): AssembledPart[] {
  const assembler = new SegmentAssembler();
  const parts: AssembledPart[] = [];
  for (const chunk of chunks) {
    const result = assembler.push(chunk);
    expect(result.ok).toBe(true);
    parts.push(...(result.ok ? result.value : []));
  }
  return parts;
}

describe('SegmentAssembler', () => {
  const stream = trackStream(VIDEO_TRACK, 3);

  test.each([1, 3, 7, 16, 100, 1000, 100_000])('finds the init section and the three segments when the player appends %s bytes at a time', (size) => {
    const parts = feed(chunked(stream, size));

    expect(parts.map((part) => part.kind)).toEqual(['init', 'segment', 'segment', 'segment']);
    expect(concatBytes(parts.map((part) => part.bytes))).toEqual(concatBytes(stream));
  });

  test('each segment is its moof and mdat together', () => {
    const parts = feed(stream);

    expect(parts[1]?.bytes).toEqual(secondSegment(VIDEO_TRACK, 0));
    expect(parts[3]?.bytes).toEqual(secondSegment(VIDEO_TRACK, 2));
  });

  test('gives nothing until a box is whole', () => {
    const assembler = new SegmentAssembler();
    const init = stream[0] ?? new Uint8Array();

    const early = assembler.push(init.subarray(0, init.length - 1));
    const done = assembler.push(init.subarray(init.length - 1));

    expect(early).toEqual({ ok: true, value: [] });
    expect(done.ok && done.value.map((part) => part.kind)).toEqual(['init']);
  });

  test('a segment keeps the boxes that come before its moof', () => {
    const styp = box('styp', ascii('msdh'), u32(0));
    const sidx = box('sidx', new Uint8Array(12));
    const media = secondSegment(VIDEO_TRACK, 5);

    const parts = feed([concatBytes([styp, sidx, media])]);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.bytes).toEqual(concatBytes([styp, sidx, media]));
  });

  test('skips free space and an mdat without a moof', () => {
    const parts = feed([concatBytes([box('free', new Uint8Array(20)), box('mdat', new Uint8Array(10))])]);

    expect(parts).toEqual([]);
  });

  test('a second init section is a second init part', () => {
    const parts = feed([...stream, ...trackStream({ ...VIDEO_TRACK, timescale: 90_000 }, 1)]);

    expect(parts.map((part) => part.kind)).toEqual(['init', 'segment', 'segment', 'segment', 'init', 'segment']);
  });

  test.each([
    ['a box smaller than its header', concatBytes([u32(4), ascii('moof'), new Uint8Array(8)])],
    ['a box that runs to the end of the stream', concatBytes([u32(0), ascii('mdat'), new Uint8Array(8)])],
    ['a box that is far too large', concatBytes([u32(0x7fffffff), ascii('mdat'), new Uint8Array(8)])],
  ])('reports %s and refuses anything after it', (_name, bytes) => {
    const assembler = new SegmentAssembler();

    const first = assembler.push(bytes);
    const second = assembler.push(stream[0] ?? new Uint8Array());

    expect(first).toEqual({ ok: false, error: DAMAGED_STREAM });
    expect(second).toEqual({ ok: false, error: DAMAGED_STREAM });
  });

  test('reads a box with a 64-bit size', () => {
    const body = new Uint8Array(10);
    const wide = concatBytes([u32(1), ascii('free'), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 26]), body]);
    const assembler = new SegmentAssembler();

    const result = assembler.push(concatBytes([wide, ...stream.slice(0, 1)]));

    expect(result.ok && result.value.map((part) => part.kind)).toEqual(['init']);
  });
});
