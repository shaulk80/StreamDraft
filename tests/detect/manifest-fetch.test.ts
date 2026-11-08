import { describe, expect, test, vi } from 'vitest';
import { createManifestFetcher, MAX_MANIFEST_BYTES, type FetchLike, type ResponseLike } from '../../src/detect/manifest-fetch.ts';

function response(overrides: Partial<ResponseLike> & { contentLength?: string } = {}): ResponseLike {
  const { contentLength, ...rest } = overrides;
  return {
    ok: true,
    status: 200,
    url: 'https://cdn.example.com/final.m3u8',
    headers: { get: (name) => (name === 'content-length' ? (contentLength ?? null) : null) },
    text: () => Promise.resolve('#EXTM3U'),
    ...rest,
  };
}

function fetcherFor(answer: () => Promise<ResponseLike>) {
  const fetchLike = vi.fn<FetchLike>(answer);
  return { fetchText: createManifestFetcher(fetchLike), fetchLike };
}

describe('createManifestFetcher', () => {
  test('gives the text and the address after redirects', async () => {
    const { fetchText } = fetcherFor(() => Promise.resolve(response()));

    expect(await fetchText('https://cdn.example.com/start.m3u8')).toEqual({
      ok: true,
      value: { text: '#EXTM3U', url: 'https://cdn.example.com/final.m3u8' },
    });
  });

  test('sends the cookies of the user', async () => {
    const { fetchText, fetchLike } = fetcherFor(() => Promise.resolve(response()));

    await fetchText('https://cdn.example.com/start.m3u8');

    expect(fetchLike).toHaveBeenCalledWith('https://cdn.example.com/start.m3u8', expect.objectContaining({ credentials: 'include' }));
  });

  test('an empty final address falls back to the requested one', async () => {
    const { fetchText } = fetcherFor(() => Promise.resolve(response({ url: '' })));

    const result = await fetchText('https://cdn.example.com/start.m3u8');

    expect(result.ok && result.value.url).toBe('https://cdn.example.com/start.m3u8');
  });

  test.each([
    ['a refusal', () => Promise.resolve(response({ ok: false, status: 403 })), '403'],
    ['a network error', () => Promise.reject(new TypeError('NetworkError')), 'Check the connection'],
    ['a declared size over the limit', () => Promise.resolve(response({ contentLength: String(MAX_MANIFEST_BYTES + 1) })), 'too large'],
    ['a body over the limit', () => Promise.resolve(response({ text: () => Promise.resolve('x'.repeat(MAX_MANIFEST_BYTES + 1)) })), 'too large'],
  ])('%s gives an error', async (_name, answer, messagePart) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fetchText } = fetcherFor(answer);

    const result = await fetchText('https://cdn.example.com/a.m3u8');

    expect(!result.ok && result.error).toContain(messagePart);
  });
});
