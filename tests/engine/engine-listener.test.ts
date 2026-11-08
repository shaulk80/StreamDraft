import { describe, expect, test, vi } from 'vitest';
import type { MediaItem, QualityOption } from '../../src/core/media.ts';
import { fail, ok } from '../../src/core/result.ts';
import { createEngineListener, type EngineControl } from '../../src/engine/engine-listener.ts';
import { engineCommandMessage } from '../../src/engine/engine-messages.ts';
import type { EngineJob } from '../../src/engine/engine-types.ts';

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

function setup() {
  const engine = {
    start: vi.fn<EngineControl['start']>(() => ok(undefined)),
    cancel: vi.fn<EngineControl['cancel']>(),
    release: vi.fn<EngineControl['release']>(() => Promise.resolve()),
    heldJobs: vi.fn<EngineControl['heldJobs']>(() => 2),
  };
  return { engine, listener: createEngineListener(engine) };
}

describe('createEngineListener', () => {
  test('starts the job and answers that it was accepted', async () => {
    const { engine, listener } = setup();

    const answer = await listener(engineCommandMessage({ kind: 'start', job: JOB }), {});

    expect(answer).toEqual(ok(undefined));
    expect(engine.start).toHaveBeenCalledWith(JOB);
  });

  test('passes the refusal of the engine on', async () => {
    const { engine, listener } = setup();
    engine.start.mockReturnValue(fail('A download with this name is already running.'));

    const answer = await listener(engineCommandMessage({ kind: 'start', job: JOB }), {});

    expect(answer).toEqual(fail('A download with this name is already running.'));
  });

  test('cancels, releases and tells how many jobs it holds', async () => {
    const { engine, listener } = setup();

    await listener(engineCommandMessage({ kind: 'cancel', jobId: 'job1' }), {});
    await listener(engineCommandMessage({ kind: 'release', jobId: 'job1' }), {});
    const status = await listener(engineCommandMessage({ kind: 'status' }), {});

    expect(engine.cancel).toHaveBeenCalledWith('job1');
    expect(engine.release).toHaveBeenCalledWith('job1');
    expect(status).toEqual(ok(2));
  });

  test.each<[string, unknown, object]>([
    ['another message', { type: 'ping' }, {}],
    ['a command from a page', engineCommandMessage({ kind: 'status' }), { tab: { id: 3 } }],
  ])('does not answer %s, so other listeners can', (_name, message, sender) => {
    const { engine, listener } = setup();

    expect(listener(message, sender)).toBeUndefined();
    expect(engine.heldJobs).not.toHaveBeenCalled();
  });
});
