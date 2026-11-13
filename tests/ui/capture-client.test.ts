import { describe, expect, test, vi } from 'vitest';
import { backgroundCaptureClient, type CaptureClient } from '../../src/ui/capture-client.ts';

const TAB = 7;

function clientAnswering(reply: unknown) {
  const send = vi.fn<(message: unknown) => Promise<unknown>>().mockResolvedValue(reply);
  return { send, client: backgroundCaptureClient(send, TAB) };
}

describe('backgroundCaptureClient', () => {
  test.each<[string, object, (client: CaptureClient) => Promise<unknown>]>([
    ['arm', { kind: 'arm', tabId: TAB }, (client) => client.arm()],
    ['status', { kind: 'status', tabId: TAB }, (client) => client.status()],
    ['save', { kind: 'save', tabId: TAB, soundOnly: true }, (client) => client.save(true)],
    ['discard', { kind: 'discard', tabId: TAB }, (client) => client.discard()],
  ])('%s sends the command for the popup tab', async (_name, command, call) => {
    const { send, client } = clientAnswering({ ok: true, value: { buffers: [], missing: [], filename: 'a.mp4', jobId: 'j' } });

    await call(client);

    expect(send).toHaveBeenCalledWith({ type: 'capture-command', command });
  });

  test('a snapshot comes through', async () => {
    const snapshot = { protected: false, buffers: [], missing: [], problems: [], complete: false };
    const { client } = clientAnswering({ ok: true, value: snapshot });

    expect(await client.status()).toEqual({ ok: true, value: snapshot });
  });

  test('a started save gives the file and the job', async () => {
    const { client } = clientAnswering({ ok: true, value: { filename: 'a.mp4', jobId: 'job-1' } });

    expect(await client.save(false)).toEqual({ ok: true, value: { filename: 'a.mp4', jobId: 'job-1' } });
  });

  test.each<[string, (client: CaptureClient) => Promise<{ ok: boolean }>]>([
    ['status', (client) => client.status()],
    ['save', (client) => client.save(false)],
  ])('%s with an answer of the wrong shape is an error', async (_name, call) => {
    const { client } = clientAnswering({ ok: true, value: 'nonsense' });

    expect((await call(client)).ok).toBe(false);
  });

  test('the background reason is passed on', async () => {
    const { client } = clientAnswering({ ok: false, error: 'The recording is not complete.' });

    expect(await client.save(false)).toEqual({ ok: false, error: 'The recording is not complete.' });
  });

  test.each([[undefined], [null], [{}]])('no usable answer (%j) is an error with a next step', async (reply) => {
    const { client } = clientAnswering(reply);

    const result = await client.arm();

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('try again');
  });

  test('a background that does not answer is an error, and is logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = backgroundCaptureClient(() => Promise.reject(new Error('gone')), TAB);

    const result = await client.discard();

    expect(result.ok).toBe(false);
    expect(logged).toHaveBeenCalled();
  });
});
