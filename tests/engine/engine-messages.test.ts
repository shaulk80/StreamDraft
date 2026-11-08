import { describe, expect, test } from 'vitest';
import type { MediaItem, QualityOption } from '../../src/core/media.ts';
import { fail, ok } from '../../src/core/result.ts';
import {
  engineCommandMessage,
  engineSignalMessage,
  parseEngineCommandMessage,
  parseEngineSignalMessage,
  type EngineCommand,
} from '../../src/engine/engine-messages.ts';
import type { EngineJob, EngineSignal } from '../../src/engine/engine-types.ts';

const ITEM: MediaItem = {
  id: 'https://cdn.example.com/master.m3u8',
  url: 'https://cdn.example.com/master.m3u8',
  title: 'Show',
  site: 'cdn.example.com',
  kind: 'hls',
  container: 'mp4',
  qualities: [],
  protected: false,
};
const OPTION: QualityOption = { quality: '720p', label: '720p', variant: { variantId: 'https://cdn.example.com/v720.m3u8' } };
const JOB: EngineJob = { jobId: 'job1', filename: 'Show.mp4', item: ITEM, option: OPTION };

describe('engine commands', () => {
  test.each<[string, EngineCommand]>([
    ['start', { kind: 'start', job: JOB }],
    ['cancel', { kind: 'cancel', jobId: 'job1' }],
    ['release', { kind: 'release', jobId: 'job1' }],
    ['status', { kind: 'status' }],
  ])('a %s command survives the trip', (_name, command) => {
    expect(parseEngineCommandMessage(engineCommandMessage(command))).toEqual(ok(command));
  });

  test.each<[string, unknown]>([
    ['nothing', undefined],
    ['text', 'start'],
    ['another message', { type: 'ping' }],
    ['no command', { type: 'engine-command' }],
    ['an unknown command', { type: 'engine-command', command: { kind: 'format' } }],
    ['a cancel without a job', { type: 'engine-command', command: { kind: 'cancel' } }],
    ['a start without a job', { type: 'engine-command', command: { kind: 'start' } }],
    ['a start with a direct file', { type: 'engine-command', command: { kind: 'start', job: { ...JOB, item: { ...ITEM, kind: 'direct' } } } }],
    ['a start without a file name', { type: 'engine-command', command: { kind: 'start', job: { ...JOB, filename: '' } } }],
    ['a start without a rendition', { type: 'engine-command', command: { kind: 'start', job: { ...JOB, option: { quality: '720p', label: '720p' } } } }],
  ])('refuses %s', (_name, message) => {
    expect(parseEngineCommandMessage(message).ok).toBe(false);
  });
});

describe('engine signals', () => {
  const FINISHED = { jobId: 'job1', filename: 'Show.mp4', url: 'blob:abc', bytes: 10 };

  test.each<[string, EngineSignal]>([
    ['idle', { kind: 'idle' }],
    ['progress', { kind: 'progress', jobId: 'job1', progress: { doneSegments: 1, totalSegments: 2, bytes: 3 } }],
    ['a finished file', { kind: 'finished', jobId: 'job1', result: ok(FINISHED) }],
    ['a failure', { kind: 'finished', jobId: 'job1', result: fail('Segment 1 of 2: The server answered 404.') }],
  ])('%s survives the trip', (_name, signal) => {
    expect(parseEngineSignalMessage(engineSignalMessage(signal))).toEqual(ok(signal));
  });

  test.each<[string, unknown]>([
    ['nothing', undefined],
    ['another message', { type: 'found-media', candidates: [] }],
    ['an unknown signal', { type: 'engine-signal', signal: { kind: 'dance' } }],
    ['progress without a job', { type: 'engine-signal', signal: { kind: 'progress', progress: { doneSegments: 1, totalSegments: 2, bytes: 3 } } }],
    ['progress with a negative count', { type: 'engine-signal', signal: { kind: 'progress', jobId: 'job1', progress: { doneSegments: -1, totalSegments: 2, bytes: 3 } } }],
    ['a result without a file', { type: 'engine-signal', signal: { kind: 'finished', jobId: 'job1', result: { ok: true } } }],
    ['a file of another job', { type: 'engine-signal', signal: { kind: 'finished', jobId: 'job2', result: ok(FINISHED) } }],
  ])('refuses %s', (_name, message) => {
    expect(parseEngineSignalMessage(message).ok).toBe(false);
  });
});
