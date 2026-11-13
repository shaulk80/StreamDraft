import { describe, expect, test } from 'vitest';
import { formatSiteList, isListedSite, matchPatternsFor, normalizeSite, parseSiteList } from '../../src/core/site-list.ts';

describe('normalizeSite', () => {
  test.each([
    ['a plain name', 'youtube.com', 'youtube.com'],
    ['capitals and spaces', '  YouTube.COM ', 'youtube.com'],
    ['a wildcard in front', '*.youtube.com', 'youtube.com'],
    ['a name without a dot', 'localhost', 'localhost'],
    ['an address', '127.0.0.1', '127.0.0.1'],
  ])('accepts %s', (_name, text, expected) => {
    expect(normalizeSite(text)).toEqual({ ok: true, value: expected });
  });

  test.each([
    ['an empty text', ''],
    ['a web address', 'https://youtube.com/watch?v=1'],
    ['a path', 'youtube.com/watch'],
    ['a port', 'localhost:8123'],
    ['a space inside', 'you tube'],
    ['a dash at the start', '-bad.example'],
    ['two dots in a row', 'a..example'],
  ])('rejects %s with a message that says what to write', (_name, text) => {
    const result = normalizeSite(text);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('youtube.com');
  });
});

describe('parseSiteList', () => {
  test.each([
    ['one per line', 'a.example\nb.example', ['a.example', 'b.example']],
    ['commas, spaces and empty lines', 'a.example, b.example;\n\n  c.example ', ['a.example', 'b.example', 'c.example']],
    ['a repeated site once', 'a.example\nA.example\n*.a.example', ['a.example']],
    ['an empty text', '  \n ', []],
  ])('reads %s', (_name, text, expected) => {
    expect(parseSiteList(text)).toEqual({ ok: true, value: expected });
  });

  test('stops at the first bad entry and names it', () => {
    const result = parseSiteList('a.example\nhttps://b.example/x\nc.example');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('https://b.example/x');
  });

  test('refuses too many sites', () => {
    const text = Array.from({ length: 51 }, (_, index) => `site${index}.example`).join('\n');

    expect(parseSiteList(text).ok).toBe(false);
  });

  test('the formatted list reads back as the same list', () => {
    const sites = ['a.example', 'b.example'];

    expect(parseSiteList(formatSiteList(sites))).toEqual({ ok: true, value: sites });
  });
});

describe('matchPatternsFor', () => {
  test.each([
    ['a site with subdomains', ['youtube.com'], ['*://youtube.com/*', '*://*.youtube.com/*']],
    ['a name without a dot', ['localhost'], ['*://localhost/*']],
    ['an address', ['127.0.0.1'], ['*://127.0.0.1/*']],
    ['several sites keep their order', ['a.example', '127.0.0.1'], ['*://a.example/*', '*://*.a.example/*', '*://127.0.0.1/*']],
    ['no sites', [], []],
  ])('%s', (_name, sites, expected) => {
    expect(matchPatternsFor(sites)).toEqual(expected);
  });
});

describe('isListedSite', () => {
  test.each<[string, string[], string | undefined, boolean]>([
    ['the site itself', ['youtube.com'], 'https://youtube.com/watch?v=1', true],
    ['a subdomain', ['youtube.com'], 'https://www.youtube.com/watch?v=1', true],
    ['another site that ends the same way', ['youtube.com'], 'https://notyoutube.com/', false],
    ['a site that only contains the name', ['youtube.com'], 'https://youtube.com.evil.example/', false],
    ['an unlisted site', ['youtube.com'], 'https://example.com/', false],
    ['one of several', ['example.org', 'youtube.com'], 'http://m.youtube.com/', true],
    ['an address', ['127.0.0.1'], 'http://127.0.0.1:8123/mse.html', true],
    ['a name that merely ends like an address', ['127.0.0.1'], 'http://10.127.0.0.1/', false],
    ['an address that is not a web page', ['youtube.com'], 'moz-extension://abc/popup.html', false],
    ['no address', ['youtube.com'], undefined, false],
    ['text that is no address', ['youtube.com'], 'youtube.com', false],
    ['no sites', [], 'https://youtube.com/', false],
  ])('%s', (_name, sites, address, expected) => {
    expect(isListedSite(sites, address)).toBe(expected);
  });
});
