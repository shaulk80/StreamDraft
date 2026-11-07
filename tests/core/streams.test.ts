import { describe, expect, test } from 'vitest';
import { pickQuality, type MediaItem, type StreamVariant } from '../../src/core/media.ts';
import { buildQualityOptions, estimateSizeBytes, qualityForHeight } from '../../src/core/streams.ts';
import type { Quality } from '../../src/core/settings.ts';

function variant(variantId: string, height: number | undefined, bandwidth?: number, extra: Partial<StreamVariant> = {}): StreamVariant {
  return { variantId, height, bandwidth, ...extra };
}

function itemWith(variants: StreamVariant[]): MediaItem {
  return {
    id: 'stream',
    url: 'https://example.com/master.m3u8',
    title: 'Stream',
    site: 'example.com',
    kind: 'hls',
    container: 'mp4',
    qualities: buildQualityOptions(variants),
    protected: false,
  };
}

describe('qualityForHeight', () => {
  test.each<[string, number | undefined, Quality]>([
    ['unknown height is best', undefined, 'best'],
    ['4K is best', 2160, 'best'],
    ['1440p is best', 1440, 'best'],
    ['just under 1440p is 1080p', 1439, '1080p'],
    ['1080p', 1080, '1080p'],
    ['just under 1080p falls to 720p', 1079, '720p'],
    ['720p', 720, '720p'],
    ['576p falls to 480p', 576, '480p'],
    ['432p falls to 360p', 432, '360p'],
    ['360p', 360, '360p'],
    ['270p stays in the lowest bucket', 270, '360p'],
    ['zero stays in the lowest bucket', 0, '360p'],
  ])('%s', (_name, height, expected) => {
    expect(qualityForHeight(height)).toBe(expected);
  });
});

describe('estimateSizeBytes', () => {
  test.each<[string, number | undefined, number | undefined, number | undefined]>([
    ['bit rate and length', 8_000_000, 100, 100_000_000],
    ['rounds to whole bytes', 1001, 1, 125],
    ['unknown bit rate', undefined, 100, undefined],
    ['unknown length', 8_000_000, undefined, undefined],
    ['zero bit rate', 0, 100, undefined],
    ['zero length', 8_000_000, 0, undefined],
  ])('%s', (_name, bandwidth, duration, expected) => {
    expect(estimateSizeBytes(bandwidth, duration)).toBe(expected);
  });
});

describe('buildQualityOptions', () => {
  test('keeps the tallest rendition of each bucket, best first, and shows its real height', () => {
    const options = buildQualityOptions([
      variant('270', 270, 400_000),
      variant('432', 432, 900_000),
      variant('1080', 1080, 5_000_000),
      variant('576', 576, 2_000_000),
      variant('360', 360, 600_000),
      variant('720', 720, 3_000_000),
    ]);

    expect(options.map((option) => [option.quality, option.label, option.variant?.variantId])).toEqual([
      ['1080p', '1080p', '1080'],
      ['720p', '720p', '720'],
      ['480p', '576p', '576'],
      ['360p', '432p', '432'],
      ['audio', 'Audio only', '270'],
    ]);
  });

  test('of two renditions of the same height the higher bit rate wins', () => {
    const options = buildQualityOptions([variant('low', 720, 1_000_000), variant('high', 720, 3_000_000)]);

    expect(options.find((option) => option.quality === '720p')?.variant?.variantId).toBe('high');
  });

  test('a stream taller than 1080p lists it as best next to the real 1080p', () => {
    const item = itemWith([variant('4k', 2160, 15_000_000), variant('hd', 1080, 5_000_000)]);

    expect(item.qualities.map((option) => [option.quality, option.label])).toEqual([
      ['best', '2160p'],
      ['1080p', '1080p'],
      ['audio', 'Audio only'],
    ]);
    expect(pickQuality(item, 'best')?.variant?.variantId).toBe('4k');
    expect(pickQuality(item, '1080p')?.variant?.variantId).toBe('hd');
  });

  test('a high frame rate is part of the label', () => {
    const options = buildQualityOptions([variant('a', 1080, 6_000_000, { frameRate: 59.94 })]);

    expect(options[0]?.label).toBe('1080p60');
  });

  test('renditions of unknown height collapse into one best option', () => {
    const options = buildQualityOptions([variant('a', undefined, 1_000_000), variant('b', undefined, 2_000_000)]);

    expect(options.map((option) => [option.quality, option.label, option.variant?.variantId])).toEqual([
      ['best', 'Best quality', 'b'],
      ['audio', 'Audio only', 'a'],
    ]);
  });

  test('sizes come from bit rate and length when the length is known', () => {
    const options = buildQualityOptions([variant('a', 720, 8_000_000)], 100);

    expect(options[0]?.sizeBytes).toBe(100_000_000);
  });

  describe('audio only', () => {
    test('with no audio rendition the sound is taken out of the lightest video rendition', () => {
      const options = buildQualityOptions([variant('big', 1080, 5_000_000), variant('small', 360, 600_000)], 100);
      const audio = options.at(-1);

      expect(audio?.quality).toBe('audio');
      expect(audio?.variant).toMatchObject({ variantId: 'small', audioOnly: false });
      expect(audio?.sizeBytes).toBeUndefined();
    });

    test('a rendition of its own is used and sized', () => {
      const options = buildQualityOptions(
        [
          variant('video', 720, 3_000_000),
          variant('aac-low', undefined, 64_000, { audioOnly: true }),
          variant('aac-high', undefined, 128_000, { audioOnly: true }),
        ],
        100,
      );
      const audio = options.at(-1);

      expect(options.map((option) => option.quality)).toEqual(['720p', 'audio']);
      expect(audio?.variant).toMatchObject({ variantId: 'aac-high', audioOnly: true });
      expect(audio?.sizeBytes).toBe(1_600_000);
    });

    test('an audio-only stream offers just the audio', () => {
      const options = buildQualityOptions([variant('aac', undefined, 64_000, { audioOnly: true })]);

      expect(options.map((option) => option.quality)).toEqual(['audio']);
    });
  });

  test('a stream without renditions has no options', () => {
    expect(buildQualityOptions([])).toEqual([]);
  });
});
