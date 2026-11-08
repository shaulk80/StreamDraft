import { afterEach, describe, expect, test, vi } from 'vitest';
import type { MediaItem, QualityOption } from '../../src/core/media.ts';
import { engineCommandMessage } from '../../src/engine/engine-messages.ts';
import type { EngineEvent, EngineJob } from '../../src/engine/engine-types.ts';
import { OffscreenEngineHost, type OffscreenApi } from '../../src/engine/offscreen-engine-host.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

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
const ACCEPTED = { ok: true, value: undefined };

function setup(hasDocument = false) {
  const api = {
    hasDocument: vi.fn<OffscreenApi['hasDocument']>(() => Promise.resolve(hasDocument)),
    createDocument: vi.fn<OffscreenApi['createDocument']>(() => Promise.resolve()),
    closeDocument: vi.fn<OffscreenApi['closeDocument']>(() => Promise.resolve()),
    send: vi.fn<OffscreenApi['send']>(() => Promise.resolve(ACCEPTED)),
  };
  const events: EngineEvent[] = [];
  const host = new OffscreenEngineHost(api, (event) => events.push(event));
  return { host, api, events };
}

describe('OffscreenEngineHost.start', () => {
  test('opens the document first and then sends the job', async () => {
    const { host, api } = setup();

    const result = await host.start(JOB);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(api.createDocument).toHaveBeenCalledOnce();
    expect(api.send).toHaveBeenCalledWith(engineCommandMessage({ kind: 'start', job: JOB }));
  });

  test('uses the document that is already open', async () => {
    const { host, api } = setup(true);

    await host.start(JOB);

    expect(api.createDocument).not.toHaveBeenCalled();
  });

  test('two jobs started together open the document once', async () => {
    const { host, api } = setup();

    await Promise.all([host.start(JOB), host.start({ ...JOB, jobId: 'job2' })]);

    expect(api.createDocument).toHaveBeenCalledOnce();
    expect(api.send).toHaveBeenCalledTimes(2);
  });

  test('a document that cannot be opened is reported in plain words', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, api } = setup();
    api.createDocument.mockRejectedValue(new Error('Only a single offscreen document may be created'));

    const result = await host.start(JOB);

    expect(!result.ok && result.error).toContain('not available');
    expect(api.send).not.toHaveBeenCalled();
  });

  test.each<[string, () => Promise<unknown>, string]>([
    ['the engine refuses the job', () => Promise.resolve({ ok: false, error: 'A download with this name is already running.' }), 'already running'],
    ['nobody answers', () => Promise.resolve(undefined), 'not available'],
    ['the message cannot be delivered', () => Promise.reject(new Error('Could not establish connection')), 'not available'],
  ])('reports it when %s', async (_name, answer, messagePart) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, api } = setup(true);
    api.send.mockImplementation(answer);

    const result = await host.start(JOB);

    expect(!result.ok && result.error).toContain(messagePart);
  });
});

describe('OffscreenEngineHost commands', () => {
  test.each<[string, (host: OffscreenEngineHost) => Promise<void>, object]>([
    ['cancel', (host) => host.cancel('job1'), { kind: 'cancel', jobId: 'job1' }],
    ['release', (host) => host.release('job1'), { kind: 'release', jobId: 'job1' }],
  ])('%s is sent to the document', async (_name, run, command) => {
    const { host, api } = setup(true);

    await run(host);

    expect(api.send).toHaveBeenCalledWith({ type: 'engine-command', command });
  });
});

describe('OffscreenEngineHost.receive', () => {
  test('passes progress and results on', async () => {
    const { host, events } = setup();
    const progress: EngineEvent = { kind: 'progress', jobId: 'job1', progress: { doneSegments: 1, totalSegments: 2, bytes: 3 } };

    await host.receive(progress);

    expect(events).toEqual([progress]);
  });

  test('closes the document when it reports being idle and really holds nothing', async () => {
    const { host, api, events } = setup(true);
    api.send.mockResolvedValue({ ok: true, value: 0 });

    await host.receive({ kind: 'idle' });

    expect(api.send).toHaveBeenCalledWith(engineCommandMessage({ kind: 'status' }));
    expect(api.closeDocument).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
  });

  test.each<[string, unknown]>([
    ['it holds a job again', { ok: true, value: 1 }],
    ['it does not answer', undefined],
  ])('keeps the document open when %s', async (_name, answer) => {
    const { host, api } = setup(true);
    api.send.mockResolvedValue(answer);

    await host.receive({ kind: 'idle' });

    expect(api.closeDocument).not.toHaveBeenCalled();
  });

  test('keeps the document open when a job was started while it was asked', async () => {
    const { host, api } = setup(true);
    api.send.mockImplementation(async (message) => {
      const kind = (message as { command: { kind: string } }).command.kind;
      if (kind === 'status') {
        await host.start(JOB);
        return { ok: true, value: 0 };
      }
      return ACCEPTED;
    });

    await host.receive({ kind: 'idle' });

    expect(api.closeDocument).not.toHaveBeenCalled();
  });

  test('a document that cannot be closed is logged, not thrown', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, api } = setup(true);
    api.send.mockResolvedValue({ ok: true, value: 0 });
    api.closeDocument.mockRejectedValue(new Error('No offscreen document'));

    await host.receive({ kind: 'idle' });

    expect(logged).toHaveBeenCalled();
  });
});
