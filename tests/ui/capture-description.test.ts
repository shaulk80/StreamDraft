import { describe, expect, test } from 'vitest';
import type { BufferSnapshot, CaptureSnapshot, TimeRange } from '../../src/extractors/capture/types.ts';
import { describeCapture } from '../../src/ui/capture-description.ts';

function buffer(overrides: Partial<BufferSnapshot> = {}): BufferSnapshot {
  return {
    bufferId: 1,
    sourceId: 1,
    mime: 'video/mp4; codecs="avc1.4d401e"',
    kind: 'video',
    initStored: true,
    fragmentCount: 3,
    duplicateCount: 0,
    covered: [{ start: 0, end: 80 }],
    coveredSeconds: 80,
    ...overrides,
  };
}

function snapshot(overrides: Partial<CaptureSnapshot> = {}): CaptureSnapshot {
  return {
    protected: false,
    durationSeconds: 225,
    buffers: [buffer(), buffer({ bufferId: 2, kind: 'audio', covered: [{ start: 0, end: 90 }], coveredSeconds: 90 })],
    missing: [{ start: 90, end: 225 }],
    problems: [],
    complete: false,
    ...overrides,
  };
}

describe('describeCapture', () => {
  test('a page without a recording offers Record', () => {
    expect(describeCapture(undefined)).toMatchObject({ phase: 'idle', canSave: false });
  });

  test.each<[string, CaptureSnapshot, string, string]>([
    ['an armed page whose player has not started', snapshot({ buffers: [], missing: [] }), 'waiting', 'not started yet'],
    ['a recording that goes on', snapshot(), 'recording', 'Recording: 1:20 of 3:45.'],
    ['a recording whose length is not known yet', snapshot({ durationSeconds: undefined, missing: [] }), 'recording', 'Recording: 1:20 so far.'],
    ['a complete recording', snapshot({ complete: true, missing: [] }), 'ready', 'The whole video is recorded (3:45).'],
    ['a protected video', snapshot({ protected: true, buffers: [], problems: ['Encrypted media. Not recorded.'] }), 'problem', 'Encrypted media. Not recorded.'],
    ['a protected video without a reason', snapshot({ protected: true, buffers: [], problems: [] }), 'problem', 'protected'],
    [
      'a quality switch',
      snapshot({ buffers: [buffer({ stoppedBecause: 'The player changed the quality in the middle of the video.' })] }),
      'problem',
      'changed the quality in the middle of the video. Press Record to start again.',
    ],
  ])('%s', (_name, input, phase, text) => {
    const description = describeCapture(input);

    expect(description.phase).toBe(phase);
    expect(description.text).toContain(text);
  });

  test.each<[string, CaptureSnapshot, boolean]>([
    ['a complete recording', snapshot({ complete: true, missing: [] }), true],
    ['one that goes on', snapshot(), false],
    ['one that stopped', snapshot({ buffers: [buffer({ stoppedBecause: 'Stopped.' })], complete: false }), false],
  ])('%s can be saved: %s', (_name, input, canSave) => {
    expect(describeCapture(input).canSave).toBe(canSave);
  });

  test('progress is the covered time of the weakest buffer', () => {
    expect(describeCapture(snapshot()).fraction).toBeCloseTo(80 / 225);
  });

  test('progress never goes past the end', () => {
    const over = snapshot({ buffers: [buffer({ coveredSeconds: 230 })] });

    expect(describeCapture(over).fraction).toBe(1);
  });

  test('a length of the video that is not known means no progress to show', () => {
    expect(describeCapture(snapshot({ durationSeconds: undefined })).fraction).toBeUndefined();
  });

  test.each<[string, TimeRange[], string | undefined]>([
    ['nothing is skipped when only the end is missing', [{ start: 90, end: 225 }], undefined],
    ['a part before the recorded end was skipped', [{ start: 20, end: 40 }, { start: 90, end: 225 }], 'Parts of the video were skipped (0:20 to 0:40).'],
  ])('%s', (_name, missing, note) => {
    const description = describeCapture(snapshot({ missing }));

    if (note === undefined) {
      expect(description.note).toBeUndefined();
      return;
    }
    expect(description.note).toContain(note);
  });
});
