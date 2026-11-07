import { describe, expect, test } from 'vitest';
import { candidatesFromElements, type MediaElementInfo } from '../../src/detect/dom-candidates.ts';

const PAGE = { url: 'https://example.com/watch', title: 'Watch' };

function element(overrides: Partial<MediaElementInfo>): MediaElementInfo {
  return { currentSrc: '', src: '', sources: [], ...overrides };
}

describe('candidatesFromElements', () => {
  test.each<[string, MediaElementInfo, string[]]>([
    ['the file the browser chose', element({ currentSrc: 'https://example.com/a.mp4' }), ['https://example.com/a.mp4']],
    ['the src attribute before the browser chose', element({ src: 'https://example.com/b.webm' }), ['https://example.com/b.webm']],
    [
      'currentSrc wins over src and over other sources',
      element({
        currentSrc: 'https://example.com/a.webm',
        src: 'https://example.com/a.mp4',
        sources: [{ src: 'https://example.com/a.ogv', type: 'video/ogg' }],
      }),
      ['https://example.com/a.webm'],
    ],
    ['an element with nothing to play', element({}), []],
    ['sources that were not chosen yet are not guessed', element({ sources: [{ src: 'https://example.com/a.mp4', type: 'video/mp4' }] }), []],
  ])('%s', (_name, info, expected) => {
    expect(candidatesFromElements([info], PAGE).map((candidate) => candidate.url)).toEqual(expected);
  });

  test('the page address and title are attached', () => {
    const [candidate] = candidatesFromElements([element({ currentSrc: 'https://example.com/a.mp4' })], PAGE);

    expect(candidate).toMatchObject({ pageUrl: PAGE.url, pageTitle: PAGE.title });
  });

  test.each<[string, string, string | undefined]>([
    ['type of the chosen source', 'video/mp4', 'video/mp4'],
    ['a source without a type', '', undefined],
  ])('content type: %s', (_name, type, expected) => {
    const info = element({
      currentSrc: 'https://example.com/stream?id=1',
      sources: [
        { src: 'https://example.com/other', type: 'video/webm' },
        { src: 'https://example.com/stream?id=1', type },
      ],
    });

    expect(candidatesFromElements([info], PAGE)[0]?.contentType).toBe(expected);
  });

  test('one candidate per element', () => {
    const elements = [element({ currentSrc: 'https://example.com/a.mp4' }), element({ currentSrc: 'https://example.com/b.mp4' })];

    expect(candidatesFromElements(elements, PAGE)).toHaveLength(2);
  });
});
