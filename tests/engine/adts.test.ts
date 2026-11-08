import { describe, expect, test } from 'vitest';
import { concatBytes } from '../../src/engine/mp4/bytes.ts';
import { AAC_FRAME_SAMPLES, aacTrack, parseAdts, sameConfig } from '../../src/engine/mp4/adts.ts';

/** An ADTS frame: header then `body` bytes. Profile 1 is AAC LC; sample rate index 4 is 44.1 kHz. */
function frame(body: number, options: { rateIndex?: number; channels?: number; crc?: boolean } = {}): Uint8Array {
  const { rateIndex = 4, channels = 2, crc = false } = options;
  const headerSize = crc ? 9 : 7;
  const length = headerSize + body;
  const header = new Uint8Array(headerSize);
  header[0] = 0xff;
  header[1] = crc ? 0xf0 : 0xf1;
  header[2] = (1 << 6) | (rateIndex << 2) | (channels >> 2);
  header[3] = ((channels & 3) << 6) | (length >> 11);
  header[4] = (length >> 3) & 0xff;
  header[5] = ((length & 7) << 5) | 0x1f;
  header[6] = 0xfc;
  return concatBytes([header, new Uint8Array(body).fill(body)]);
}

/** An ID3v2 tag with `size` bytes of content, as HLS puts in front of each audio segment. */
function id3(size: number): Uint8Array {
  const header = Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, (size >> 7) & 0x7f, size & 0x7f);
  return concatBytes([header, new Uint8Array(size)]);
}

describe('parseAdts', () => {
  test('splits the stream into frames without their headers', () => {
    const parsed = parseAdts(concatBytes([frame(10), frame(20), frame(30)]));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.samples.map((sample) => sample.size)).toEqual([10, 20, 30]);
    expect(parsed.value.samples.every((sample) => sample.duration === AAC_FRAME_SAMPLES && sample.sync)).toBe(true);
    expect(parsed.value.payload).toEqual(concatBytes([new Uint8Array(10).fill(10), new Uint8Array(20).fill(20), new Uint8Array(30).fill(30)]));
  });

  test('reads the format from the first header', () => {
    const parsed = parseAdts(frame(5, { rateIndex: 3, channels: 6 }));

    expect(parsed.ok && parsed.value.config).toEqual({ objectType: 2, sampleRateIndex: 3, sampleRate: 48_000, channels: 6 });
  });

  test('skips the ID3 tag in front', () => {
    const parsed = parseAdts(concatBytes([id3(300), frame(12), frame(12)]));

    expect(parsed.ok && parsed.value.samples).toHaveLength(2);
  });

  test('skips the checksum of frames that have one', () => {
    const parsed = parseAdts(concatBytes([frame(8, { crc: true }), frame(8)]));

    expect(parsed.ok && parsed.value.samples.map((sample) => sample.size)).toEqual([8, 8]);
  });

  test('drops a frame cut off at the end', () => {
    const whole = concatBytes([frame(10), frame(20)]);

    const parsed = parseAdts(whole.subarray(0, whole.length - 5));

    expect(parsed.ok && parsed.value.samples.map((sample) => sample.size)).toEqual([10]);
  });

  test.each([
    ['empty data', new Uint8Array(0)],
    ['something else', new Uint8Array(200).fill(7)],
    ['only a tag', id3(20)],
    ['an impossible sample rate', frame(5, { rateIndex: 14 })],
  ])('rejects %s', (_name, data) => {
    expect(parseAdts(data)).toEqual({ ok: false, error: 'This audio file is not in a format StreamDraft can read.' });
  });
});

describe('aacTrack', () => {
  test('describes AAC with the stream\'s own sample rate as its clock', () => {
    const track = aacTrack({ objectType: 2, sampleRateIndex: 4, sampleRate: 44_100, channels: 2 });

    expect(track).toMatchObject({ kind: 'audio', timescale: 44_100, codec: 'mp4a', sourceId: 1 });
    expect(track.defaults.duration).toBe(AAC_FRAME_SAMPLES);
  });

  test('puts the AudioSpecificConfig of AAC LC, 44.1 kHz, stereo (0x1210) in the sample description', () => {
    const { sampleDescription } = aacTrack({ objectType: 2, sampleRateIndex: 4, sampleRate: 44_100, channels: 2 });

    const text = String.fromCharCode(...sampleDescription);
    expect(text).toContain('mp4a');
    expect(text).toContain('esds');
    expect(Array.from(sampleDescription).join(',')).toContain([5, 2, 0x12, 0x10].join(','));
  });

  test.each([
    [{ objectType: 2, sampleRateIndex: 4, channels: 2 }, { objectType: 2, sampleRateIndex: 4, channels: 2 }, true],
    [{ objectType: 2, sampleRateIndex: 4, channels: 2 }, { objectType: 2, sampleRateIndex: 3, channels: 2 }, false],
    [{ objectType: 2, sampleRateIndex: 4, channels: 2 }, { objectType: 5, sampleRateIndex: 4, channels: 2 }, false],
    [{ objectType: 2, sampleRateIndex: 4, channels: 2 }, { objectType: 2, sampleRateIndex: 4, channels: 1 }, false],
  ])('compares formats %j and %j: %s', (left, right, expected) => {
    expect(sameConfig({ ...left, sampleRate: 0 }, { ...right, sampleRate: 0 })).toBe(expected);
  });
});
