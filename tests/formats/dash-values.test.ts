import { describe, expect, test } from 'vitest';
import { expandTemplate, parseFrameRate, parseIsoDuration, parseNumberAttribute, parseRangeAttribute } from '../../src/formats/dash-values.ts';

describe('parseIsoDuration', () => {
  test.each([
    ['PT634.566S', 634.566],
    ['PT1H2M3S', 3723],
    ['PT0S', 0],
    ['PT90M', 5400],
    ['P1DT12H', 129600],
    ['P1W', 604800],
    [' PT10S ', 10],
  ])('%s is %s seconds', (text, seconds) => {
    expect(parseIsoDuration(text)).toBeCloseTo(seconds, 6);
  });

  test.each([undefined, '', 'P', 'PT', 'abc', '10', 'PT-5S', 'PTS'])('%s is not a duration', (text) => {
    expect(parseIsoDuration(text)).toBeUndefined();
  });
});

describe('parseFrameRate', () => {
  test.each([
    ['30', 30],
    ['25.5', 25.5],
    ['30000/1001', 29.97],
  ])('%s is %s fps', (text, rate) => {
    expect(parseFrameRate(text)).toBeCloseTo(rate, 2);
  });

  test.each([undefined, '', '0', 'x', '30/0', '-1'])('%s is not a frame rate', (text) => {
    expect(parseFrameRate(text)).toBeUndefined();
  });
});

describe('parseNumberAttribute', () => {
  test.each([
    ['5', 0, 5],
    ['0', 0, 0],
    ['1.5', 0, 1.5],
    ['0', 1, undefined],
    ['-3', 0, undefined],
    ['abc', 0, undefined],
    ['', 0, undefined],
    [undefined, 0, undefined],
  ])('%s with minimum %s is %s', (text, minimum, expected) => {
    expect(parseNumberAttribute(text, minimum)).toBe(expected);
  });
});

describe('parseRangeAttribute', () => {
  test.each([
    ['0-870', { offset: 0, length: 871 }],
    ['871-11131', { offset: 871, length: 10261 }],
    ['5-5', { offset: 5, length: 1 }],
  ])('%s', (text, expected) => {
    expect(parseRangeAttribute(text)).toEqual(expected);
  });

  test.each([undefined, '', '10', '10-', '-10', '20-10', 'a-b'])('%s is not a range', (text) => {
    expect(parseRangeAttribute(text)).toBeUndefined();
  });
});

describe('expandTemplate', () => {
  const values = { RepresentationID: 'v1', Number: 7, Time: 12000, Bandwidth: 500000 };

  test.each([
    ['$RepresentationID$/seg_$Number$.m4s', 'v1/seg_7.m4s'],
    ['seg-$Time$.m4s', 'seg-12000.m4s'],
    ['seg_$Number%05d$.m4s', 'seg_00007.m4s'],
    ['$Bandwidth$/s.m4s', '500000/s.m4s'],
    ['price$$tag_$Number$', 'price$tag_7'],
    ['plain.m4s', 'plain.m4s'],
  ])('%s becomes %s', (template, expected) => {
    expect(expandTemplate(template, values)).toBe(expected);
  });

  test('gives undefined for an identifier without a value', () => {
    expect(expandTemplate('seg_$SubNumber$.m4s', values)).toBeUndefined();
  });
});
