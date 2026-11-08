import { describe, expect, test } from 'vitest';
import { classifyCandidate, MIN_DIRECT_SIZE_BYTES } from '../../src/detect/classify.ts';

const BIG = 5 * 1024 * 1024;

describe('classifyCandidate: accepted', () => {
  test.each<[string, Parameters<typeof classifyCandidate>[0], { title: string; site: string; container: string }]>([
    [
      'title and site from the page',
      { url: 'https://cdn.example.com/v/clip.mp4', contentType: 'video/mp4', pageUrl: 'https://www.example.com/watch', pageTitle: ' My clip ' },
      { title: 'My clip', site: 'example.com', container: 'mp4' },
    ],
    [
      'title from the file name when the page has none',
      { url: 'https://cdn.example.com/v/Summer%20trip.webm', contentType: 'video/webm' },
      { title: 'Summer trip', site: 'cdn.example.com', container: 'webm' },
    ],
    [
      'blank page title is ignored',
      { url: 'https://example.com/a/clip.mp4', contentType: 'video/mp4', pageTitle: '   ' },
      { title: 'clip', site: 'example.com', container: 'mp4' },
    ],
    [
      'bad escape in the name is shown as is',
      { url: 'https://example.com/100%.mp4', contentType: 'video/mp4' },
      { title: '100%', site: 'example.com', container: 'mp4' },
    ],
    [
      'host when the path has no name',
      { url: 'https://www.example.com/', contentType: 'video/mp4' },
      { title: 'example.com', site: 'example.com', container: 'mp4' },
    ],
    [
      'extension used when the content type is generic',
      { url: 'https://example.com/a/song.m4a', contentType: 'application/octet-stream' },
      { title: 'song', site: 'example.com', container: 'm4a' },
    ],
  ])('%s', (_name, candidate, expected) => {
    const result = classifyCandidate({ sizeBytes: BIG, ...candidate });

    expect(result.ok && { title: result.value.title, site: result.value.site, container: result.value.container }).toEqual(
      expected,
    );
  });

  test('the item is a direct, downloadable file with one quality that carries the size', () => {
    const result = classifyCandidate({ url: 'https://example.com/a.mp4', contentType: 'video/mp4', sizeBytes: BIG });

    expect(result).toMatchObject({
      ok: true,
      value: {
        url: 'https://example.com/a.mp4',
        kind: 'direct',
        protected: false,
        qualities: [{ quality: 'best', label: 'MP4', sizeBytes: BIG }],
      },
    });
  });

  test('audio files say so in the label', () => {
    const result = classifyCandidate({ url: 'https://example.com/a.mp3', contentType: 'audio/mpeg' });

    expect(result.ok && result.value.qualities[0]?.label).toBe('MP3 audio');
  });

  test('the fragment is not part of the address, so two links to the same file are one item', () => {
    const first = classifyCandidate({ url: 'https://example.com/a.mp4#t=10', contentType: 'video/mp4' });
    const second = classifyCandidate({ url: 'https://example.com/a.mp4', contentType: 'video/mp4' });

    expect(first.ok && second.ok && first.value.id === second.value.id).toBe(true);
  });

  test('an unknown size is accepted', () => {
    expect(classifyCandidate({ url: 'https://example.com/a.mp4', contentType: 'video/mp4' }).ok).toBe(true);
  });

  test('exactly the minimum size is accepted', () => {
    const candidate = { url: 'https://example.com/a.mp4', contentType: 'video/mp4', sizeBytes: MIN_DIRECT_SIZE_BYTES };

    expect(classifyCandidate(candidate).ok).toBe(true);
  });
});

describe('classifyCandidate: streams', () => {
  test.each<[string, Parameters<typeof classifyCandidate>[0], 'hls' | 'dash']>([
    ['HLS by extension', { url: 'https://cdn.example.com/v/master.m3u8?token=abc', pageTitle: 'Talk' }, 'hls'],
    ['HLS by content type', { url: 'https://cdn.example.com/playlist', contentType: 'application/vnd.apple.mpegurl' }, 'hls'],
    ['DASH by extension', { url: 'https://cdn.example.com/v/manifest.mpd', pageTitle: 'Talk' }, 'dash'],
    ['DASH by content type', { url: 'https://cdn.example.com/manifest', contentType: 'application/dash+xml' }, 'dash'],
  ])('%s gives a stream that waits for its manifest', (_name, candidate, kind) => {
    const result = classifyCandidate({ sizeBytes: 800, ...candidate });

    expect(result).toMatchObject({
      ok: true,
      value: { kind, container: 'mp4', qualities: [], protected: false },
    });
  });

  test('a manifest is not too small, whatever its size', () => {
    expect(classifyCandidate({ url: 'https://example.com/a.m3u8', sizeBytes: 120 }).ok).toBe(true);
  });

  test('the query stays in the address: tokens are part of what is fetched', () => {
    const result = classifyCandidate({ url: 'https://example.com/a.m3u8?token=abc#x' });

    expect(result.ok && result.value.url).toBe('https://example.com/a.m3u8?token=abc');
  });
});

describe('classifyCandidate: rejected', () => {
  test.each<[string, Parameters<typeof classifyCandidate>[0], string]>([
    ['not an address', { url: 'not a url' }, 'valid address'],
    ['blob source', { url: 'blob:https://example.com/1234', contentType: 'video/mp4' }, 'http and https'],
    ['data source', { url: 'data:video/mp4;base64,AAAA', contentType: 'video/mp4' }, 'http and https'],
    ['a page', { url: 'https://example.com/index.html', contentType: 'text/html' }, 'Not a video'],
    ['one byte under the minimum', { url: 'https://example.com/a.mp4', contentType: 'video/mp4', sizeBytes: MIN_DIRECT_SIZE_BYTES - 1 }, 'small'],
  ])('%s', (_name, candidate, messagePart) => {
    const result = classifyCandidate(candidate);

    expect(!result.ok && result.error).toContain(messagePart);
  });
});
