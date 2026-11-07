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

describe('classifyCandidate: rejected', () => {
  test.each<[string, Parameters<typeof classifyCandidate>[0], string]>([
    ['not an address', { url: 'not a url' }, 'valid address'],
    ['blob source', { url: 'blob:https://example.com/1234', contentType: 'video/mp4' }, 'http and https'],
    ['data source', { url: 'data:video/mp4;base64,AAAA', contentType: 'video/mp4' }, 'http and https'],
    ['a page', { url: 'https://example.com/index.html', contentType: 'text/html' }, 'Not a video'],
    ['hls manifest', { url: 'https://example.com/master.m3u8' }, 'HLS'],
    ['dash manifest', { url: 'https://example.com/manifest.mpd' }, 'DASH'],
    ['one byte under the minimum', { url: 'https://example.com/a.mp4', contentType: 'video/mp4', sizeBytes: MIN_DIRECT_SIZE_BYTES - 1 }, 'small'],
  ])('%s', (_name, candidate, messagePart) => {
    const result = classifyCandidate(candidate);

    expect(!result.ok && result.error).toContain(messagePart);
  });
});
