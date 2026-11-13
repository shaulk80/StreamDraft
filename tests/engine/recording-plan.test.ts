import { describe, expect, test } from 'vitest';
import { planRecording } from '../../src/engine/recording-plan.ts';
import type { RecordingInput } from '../../src/engine/recording-input.ts';
import { recordingFixture } from './recording-fixtures.ts';

function namesOf(plan: ReturnType<typeof planRecording>): string[][] {
  return plan.ok ? plan.value.sources.map((source) => source.segments.map((segment) => segment.name)) : [];
}

describe('planRecording', () => {
  test.each<[string, boolean]>([
    ['in the order they were stored', false],
    ['latest first', true],
  ])('lists the segments of each buffer in time order, init section first (%s)', (_name, reversed) => {
    const { recording } = recordingFixture({ reversed });

    const plan = planRecording(recording, false);

    expect(namesOf(plan)).toEqual([
      ['v-0', 'v-1'],
      ['a-0', 'a-1'],
    ]);
    expect(plan.ok && plan.value.sources.map((source) => [source.format, source.init?.name])).toEqual([
      ['fmp4', 'v-init'],
      ['fmp4', 'a-init'],
    ]);
  });

  test.each<[string, boolean, boolean, string[][]]>([
    ['sound only keeps the audio buffer', true, false, [['a-0', 'a-1']]],
    ['a picture with sound keeps both', false, false, [['v-0', 'v-1'], ['a-0', 'a-1']]],
    ['sound only without an audio buffer leaves the choice to the muxer', true, true, [['v-0', 'v-1']]],
  ])('%s', (_name, soundOnly, videoOnly, expected) => {
    const { recording } = recordingFixture({ videoOnly });

    const plan = planRecording(recording, soundOnly);

    expect(namesOf(plan)).toEqual(expected);
    expect(plan.ok && plan.value.soundOnly).toBe(soundOnly);
  });

  test.each<[string, (recording: RecordingInput) => RecordingInput, string]>([
    ['no buffers', () => ({ buffers: [] }), 'no video to save'],
    [
      'a buffer without segments',
      (recording) => ({ buffers: recording.buffers.map((buffer) => ({ ...buffer, fragments: [] })) }),
      'no video to save',
    ],
    [
      'a segment without a place in time',
      (recording) => ({
        buffers: recording.buffers.map((buffer) => ({ ...buffer, fragments: buffer.fragments.map((part) => ({ ...part, startSeconds: undefined })) })),
      }),
      'where it belongs in time',
    ],
    [
      'a segment with an impossible place in time',
      (recording) => ({
        buffers: recording.buffers.map((buffer) => ({ ...buffer, fragments: buffer.fragments.map((part) => ({ ...part, startSeconds: Number.NaN })) })),
      }),
      'where it belongs in time',
    ],
    [
      'the same part named twice',
      (recording) => ({ buffers: recording.buffers.map((buffer) => ({ ...buffer, init: { ...buffer.init, name: 'same' } })) }),
      'same part twice',
    ],
  ])('refuses %s', (_name, damage, message) => {
    const plan = planRecording(damage(recordingFixture().recording), false);

    expect(!plan.ok && plan.error).toContain(message);
  });
});
