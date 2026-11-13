import { describe, expect, test } from 'vitest';
import { formatClock, gapsIn, mergeRanges, totalSeconds } from '../../../src/extractors/capture/ranges.ts';

describe('mergeRanges', () => {
  test.each([
    ['touching ranges', [{ start: 0, end: 1 }, { start: 1, end: 2 }], [{ start: 0, end: 2 }]],
    ['ranges a rounding error apart', [{ start: 0, end: 1 }, { start: 1.05, end: 2 }], [{ start: 0, end: 2 }]],
    ['ranges with a real gap', [{ start: 0, end: 1 }, { start: 2, end: 3 }], [{ start: 0, end: 1 }, { start: 2, end: 3 }]],
    ['ranges out of order', [{ start: 2, end: 3 }, { start: 0, end: 2 }], [{ start: 0, end: 3 }]],
    ['a range inside another', [{ start: 0, end: 5 }, { start: 1, end: 2 }], [{ start: 0, end: 5 }]],
    ['nothing', [], []],
  ])('joins %s', (_name, ranges, expected) => {
    expect(mergeRanges(ranges)).toEqual(expected);
  });

  test('does not change the ranges it is given', () => {
    const ranges = [{ start: 1, end: 2 }, { start: 0, end: 1 }];

    mergeRanges(ranges);

    expect(ranges).toEqual([{ start: 1, end: 2 }, { start: 0, end: 1 }]);
  });
});

describe('totalSeconds', () => {
  test('adds the lengths', () => {
    expect(totalSeconds([{ start: 0, end: 1.5 }, { start: 4, end: 6 }])).toBe(3.5);
  });
});

describe('gapsIn', () => {
  test.each([
    ['a video covered from start to end', [{ start: 0, end: 10 }], []],
    ['a start and end a few tenths short', [{ start: 0.3, end: 9.8 }], []],
    ['nothing recorded', [], [{ start: 0, end: 10 }]],
    ['a hole in the middle', [{ start: 0, end: 4 }, { start: 6, end: 10 }], [{ start: 4, end: 6 }]],
    ['a missing start', [{ start: 3, end: 10 }], [{ start: 0, end: 3 }]],
    ['a missing end', [{ start: 0, end: 7 }], [{ start: 7, end: 10 }]],
    ['ranges that touch', [{ start: 0, end: 5 }, { start: 5, end: 10 }], []],
  ])('finds %s', (_name, covered, expected) => {
    expect(gapsIn(covered, 10)).toEqual(expected);
  });
});

describe('formatClock', () => {
  test.each([
    [0, '0:00'],
    [9.9, '0:09'],
    [65, '1:05'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [-4, '0:00'],
  ])('%s seconds is %s', (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });
});
