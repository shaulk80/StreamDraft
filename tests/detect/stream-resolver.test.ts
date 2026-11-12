import { describe, expect, test, vi } from 'vitest';
import type { MediaItem } from '../../src/core/media.ts';
import { fail, ok } from '../../src/core/result.ts';
import type { FetchText } from '../../src/detect/manifest-fetch.ts';
import { MediaRegistry, type SessionAreaLike } from '../../src/detect/registry.ts';
import { MAX_RESOLVED_AT_ONCE, StreamResolver } from '../../src/detect/stream-resolver.ts';
import { MANIFEST_URL, protectedManifest, TEMPLATE_MANIFEST } from '../formats/dash-fixtures.ts';
import { BIPBOP_MASTER, FMP4_MASTER, MASTER_URL, MEDIA_URL, BIPBOP_MEDIA } from '../formats/hls-fixtures.ts';

class MemoryArea implements SessionAreaLike {
  data: Record<string, unknown> = {};

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(key in this.data ? { [key]: structuredClone(this.data[key]) } : {});
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, structuredClone(items));
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    Reflect.deleteProperty(this.data, key);
    return Promise.resolve();
  }
}

function stream(url: string, kind: 'hls' | 'dash'): MediaItem {
  return { id: url, url, title: 'Page', site: 'example.com', kind, container: 'mp4', qualities: [], protected: false };
}

/** A segment file a player fetched: a direct file as far as the network observer can tell. */
function segment(url: string): MediaItem {
  return { ...DIRECT, id: url, url };
}

const DIRECT: MediaItem = {
  id: 'https://example.com/a.mp4',
  url: 'https://example.com/a.mp4',
  title: 'Page',
  site: 'example.com',
  kind: 'direct',
  container: 'mp4',
  qualities: [{ quality: 'best', label: 'MP4' }],
  protected: false,
};

/** Serves the given texts by address; any other address is refused. */
function serving(texts: Record<string, string>) {
  return vi.fn<FetchText>((url) => {
    const text = texts[url];
    return Promise.resolve(text === undefined ? fail('The server answered 404.') : ok({ text, url }));
  });
}

async function setup(items: MediaItem[], texts: Record<string, string>) {
  const registry = new MediaRegistry(new MemoryArea());
  for (const item of items) {
    await registry.add(1, item);
  }
  const fetchText = serving(texts);
  return { registry, fetchText, resolver: new StreamResolver(registry, fetchText) };
}

describe('StreamResolver.resolveTab', () => {
  test('an HLS master gets its qualities', async () => {
    const { registry, resolver } = await setup([stream(MASTER_URL, 'hls')], { [MASTER_URL]: FMP4_MASTER });

    const count = await resolver.resolveTab(1);

    const [item] = await registry.list(1);
    expect(count).toBe(1);
    expect(item?.qualities.map((option) => option.quality)).toEqual(['1080p', '480p', 'audio']);
  });

  test('a DASH manifest gets its qualities', async () => {
    const { registry, resolver } = await setup([stream(MANIFEST_URL, 'dash')], { [MANIFEST_URL]: TEMPLATE_MANIFEST });

    await resolver.resolveTab(1);

    const [item] = await registry.list(1);
    expect(item?.qualities.at(-1)?.quality).toBe('audio');
  });

  test('the playlists of the renditions of a master are not listed', async () => {
    const rendition = 'https://cdn.example.com/video/gear3/prog_index.m3u8';
    const { registry, resolver } = await setup([stream(rendition, 'hls'), stream(MASTER_URL, 'hls')], {
      [MASTER_URL]: BIPBOP_MASTER,
      [rendition]: BIPBOP_MEDIA,
    });

    await resolver.resolveTab(1);

    expect((await registry.list(1)).map((item) => item.id)).toEqual([MASTER_URL]);
  });

  test('a rendition the player loads later is not listed either', async () => {
    const rendition = 'https://cdn.example.com/video/gear3/prog_index.m3u8';
    const { registry, resolver } = await setup([stream(MASTER_URL, 'hls')], { [MASTER_URL]: BIPBOP_MASTER });
    await resolver.resolveTab(1);

    await registry.add(1, stream(rendition, 'hls'));

    expect((await registry.list(1)).map((item) => item.id)).toEqual([MASTER_URL]);
  });

  const DASH_DIR = 'https://cdn.example.com/dash/';
  const PROTECTED_MANIFEST = protectedManifest('<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>').replace(
    's$Number$.m4s',
    's$Number$.mp4',
  );

  test.each([
    ['plain', TEMPLATE_MANIFEST, `${DASH_DIR}bbb_30fps_1920x1080_8000k/bbb_30fps_1920x1080_8000k_5.m4v`, `${DASH_DIR}bbb_30fps_1920x1080_8000k/bbb_30fps_1920x1080_8000k_6.m4v`],
    ['protected', PROTECTED_MANIFEST, `${DASH_DIR}s2.mp4`, `${DASH_DIR}s3.mp4`],
  ])('segment files of a %s DASH stream are not listed, whether they came before or after the manifest was read', async (_name, manifest, early, late) => {
    const { registry, resolver } = await setup([stream(MANIFEST_URL, 'dash'), segment(early)], { [MANIFEST_URL]: manifest });

    await resolver.resolveTab(1);
    await registry.add(1, segment(late));

    expect((await registry.list(1)).map((item) => item.id)).toEqual([MANIFEST_URL]);
  });

  test('a direct file the manifest does not name is still listed', async () => {
    const { registry, resolver } = await setup([stream(MANIFEST_URL, 'dash')], { [MANIFEST_URL]: TEMPLATE_MANIFEST });
    await resolver.resolveTab(1);

    await registry.add(1, DIRECT);

    expect((await registry.list(1)).map((item) => item.id)).toEqual([MANIFEST_URL, DIRECT.id]);
  });

  test('reads of one tab that overlap fetch a manifest once', async () => {
    const { resolver, fetchText } = await setup([stream(MANIFEST_URL, 'dash')], { [MANIFEST_URL]: TEMPLATE_MANIFEST });

    const counts = await Promise.all([resolver.resolveTab(1), resolver.resolveTab(1), resolver.resolveTab(1)]);

    expect(counts).toEqual([1, 0, 0]);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  test('relative addresses resolve against the address after a redirect', async () => {
    const { registry } = await setup([stream(MASTER_URL, 'hls')], {});
    const redirected = 'https://other.example.net/moved/master.m3u8';
    const resolverWithRedirect = new StreamResolver(registry, () => Promise.resolve(ok({ text: BIPBOP_MASTER, url: redirected })));

    await resolverWithRedirect.resolveTab(1);

    const [item] = await registry.list(1);
    expect(item?.partUrls).toContain('https://other.example.net/moved/gear1/prog_index.m3u8');
  });

  test('a stream that cannot be read keeps the reason and is tried again next time', async () => {
    const { registry, resolver, fetchText } = await setup([stream(MEDIA_URL, 'hls')], {});

    await resolver.resolveTab(1);
    const [failed] = await registry.list(1);
    await resolver.resolveTab(1);

    expect(failed?.manifestError).toContain('404');
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  test('a stream that reads on the second try loses its old error', async () => {
    const { registry, resolver } = await setup([stream(MEDIA_URL, 'hls')], {});
    await resolver.resolveTab(1);

    const second = new StreamResolver(registry, serving({ [MEDIA_URL]: BIPBOP_MEDIA }));
    await second.resolveTab(1);

    const [item] = await registry.list(1);
    expect(item).toMatchObject({ manifestError: undefined });
    expect(item?.qualities.length).toBeGreaterThan(0);
  });

  test('a page that is not a playlist gives the parser\'s message', async () => {
    const { registry, resolver } = await setup([stream(MEDIA_URL, 'hls')], { [MEDIA_URL]: '<html></html>' });

    await resolver.resolveTab(1);

    expect((await registry.list(1))[0]?.manifestError).toBe('Not an HLS playlist.');
  });

  test('a resolved stream and a direct file are not fetched', async () => {
    const { resolver, fetchText } = await setup([DIRECT, stream(MASTER_URL, 'hls')], { [MASTER_URL]: BIPBOP_MASTER });
    await resolver.resolveTab(1);
    fetchText.mockClear();

    const count = await resolver.resolveTab(1);

    expect(count).toBe(0);
    expect(fetchText).not.toHaveBeenCalled();
  });

  test('a title set while the manifest was being read is kept', async () => {
    const registry = new MediaRegistry(new MemoryArea());
    await registry.add(1, stream(MASTER_URL, 'hls'));
    const resolver = new StreamResolver(registry, async (url) => {
      await registry.retitle(1, 'Real title');
      return ok({ text: BIPBOP_MASTER, url });
    });

    await resolver.resolveTab(1);

    expect((await registry.list(1))[0]?.title).toBe('Real title');
  });

  test('no more than the limit are read at once', async () => {
    const many = Array.from({ length: MAX_RESOLVED_AT_ONCE + 3 }, (_, index) => stream(`https://cdn.example.com/${index}.m3u8`, 'hls'));
    const { resolver, fetchText } = await setup(many, {});

    const count = await resolver.resolveTab(1);

    expect(count).toBe(MAX_RESOLVED_AT_ONCE);
    expect(fetchText).toHaveBeenCalledTimes(MAX_RESOLVED_AT_ONCE);
  });

  test('a tab without videos is left alone', async () => {
    const { resolver, fetchText } = await setup([], {});

    expect(await resolver.resolveTab(1)).toBe(0);
    expect(fetchText).not.toHaveBeenCalled();
  });
});
