import { afterEach, describe, expect, test, vi } from 'vitest';
import { installMediaHook, type HookSink, type PipelineGlobals } from '../../../src/extractors/capture/media-hook.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A stand-in for the page's media pipeline: classes whose methods the hook replaces. */
function createPage(options: { withCapabilities?: boolean; withEncryption?: boolean } = {}) {
  const appended: { buffer: object; data: ArrayBuffer | ArrayBufferView }[] = [];
  const keysSet: unknown[] = [];
  const mimes: string[] = [];

  class FakeSourceBuffer {
    appendBuffer(data: ArrayBuffer | ArrayBufferView): void {
      appended.push({ buffer: this, data });
    }
  }
  class FakeMediaSource {
    duration = Number.NaN;
    static isTypeSupported(type: string): boolean {
      return type !== '';
    }
    addSourceBuffer(mime: string): FakeSourceBuffer {
      mimes.push(mime);
      return new FakeSourceBuffer();
    }
  }
  class FakeMediaElement {
    canPlayType(type: string): string {
      return type === '' ? '' : 'probably';
    }
    setMediaKeys(keys: unknown): Promise<void> {
      keysSet.push(keys);
      return Promise.resolve();
    }
  }

  const accessRequests: string[] = [];
  const decodingRequests: string[] = [];
  const navigator: NonNullable<PipelineGlobals['navigator']> = {};
  if (options.withEncryption !== false) {
    navigator.requestMediaKeySystemAccess = (keySystem) => {
      accessRequests.push(keySystem);
      return Promise.resolve({ keySystem });
    };
  }
  if (options.withCapabilities !== false) {
    navigator.mediaCapabilities = {
      decodingInfo: (configuration) => {
        decodingRequests.push(configuration.video?.contentType ?? configuration.audio?.contentType ?? '');
        return Promise.resolve({ supported: true, smooth: true, powerEfficient: true });
      },
    };
  }

  const globals: PipelineGlobals = {
    MediaSource: FakeMediaSource as unknown as PipelineGlobals['MediaSource'],
    SourceBuffer: FakeSourceBuffer as unknown as PipelineGlobals['SourceBuffer'],
    HTMLMediaElement: FakeMediaElement as unknown as PipelineGlobals['HTMLMediaElement'],
    navigator,
  };
  return { globals, FakeMediaSource, FakeMediaElement, appended, keysSet, accessRequests, decodingRequests };
}

function createSink() {
  const sink = {
    bufferAdded: vi.fn<HookSink['bufferAdded']>(),
    appended: vi.fn<HookSink['appended']>(),
    encryptedMediaUsed: vi.fn<HookSink['encryptedMediaUsed']>(),
  };
  return sink;
}

const HIDDEN_TYPES = ['video/webm; codecs="vp9"', 'video/mp4; codecs=av01.0.05M.08', 'audio/webm; codecs="opus"'];
const SHOWN_TYPES = ['video/mp4; codecs="avc1.4d401e"', 'audio/mp4; codecs="mp4a.40.2"'];

describe('installMediaHook: hiding codecs', () => {
  test.each(HIDDEN_TYPES)('with hiding on, %s is not supported, not playable and not decodable', async (type) => {
    const page = createPage();
    installMediaHook(page.globals, { hideCodecs: true }, createSink());

    expect(page.FakeMediaSource.isTypeSupported(type)).toBe(false);
    expect(new page.FakeMediaElement().canPlayType(type)).toBe('');
    await expect(page.globals.navigator?.mediaCapabilities?.decodingInfo({ video: { contentType: type } })).resolves.toEqual({ supported: false, smooth: false, powerEfficient: false });
    expect(page.decodingRequests).toEqual([]);
  });

  test.each(SHOWN_TYPES)('with hiding on, %s is answered by the browser', async (type) => {
    const page = createPage();
    installMediaHook(page.globals, { hideCodecs: true }, createSink());

    expect(page.FakeMediaSource.isTypeSupported(type)).toBe(true);
    expect(new page.FakeMediaElement().canPlayType(type)).toBe('probably');
    await expect(page.globals.navigator?.mediaCapabilities?.decodingInfo({ video: { contentType: type } })).resolves.toMatchObject({ supported: true });
  });

  test.each(HIDDEN_TYPES)('with hiding off, %s is answered by the browser', async (type) => {
    const page = createPage();
    installMediaHook(page.globals, { hideCodecs: false }, createSink());

    expect(page.FakeMediaSource.isTypeSupported(type)).toBe(true);
    expect(new page.FakeMediaElement().canPlayType(type)).toBe('probably');
    await expect(page.globals.navigator?.mediaCapabilities?.decodingInfo({ audio: { contentType: type } })).resolves.toMatchObject({ supported: true });
  });
});

describe('installMediaHook: watching the buffers', () => {
  test('reports each source buffer with ids for it and for its media source', () => {
    const page = createPage();
    const sink = createSink();
    installMediaHook(page.globals, { hideCodecs: false }, sink);

    const first = new page.FakeMediaSource();
    const second = new page.FakeMediaSource();
    first.addSourceBuffer('video/mp4; codecs="avc1.4d401e"');
    first.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    second.addSourceBuffer('video/mp4; codecs="avc1.4d401e"');

    expect(sink.bufferAdded.mock.calls.map(([event]) => [event.bufferId, event.sourceId])).toEqual([[1, 1], [2, 1], [3, 2]]);
    expect(sink.bufferAdded.mock.calls[1]?.[0].mime).toBe('audio/mp4; codecs="mp4a.40.2"');
  });

  test('hands the page its own source buffer', () => {
    const page = createPage();
    installMediaHook(page.globals, { hideCodecs: false }, createSink());

    const buffer = new page.FakeMediaSource().addSourceBuffer('video/mp4');

    expect(typeof buffer.appendBuffer).toBe('function');
  });

  test('reports an append with a copy of the bytes and the length of the video, and still appends', () => {
    const page = createPage();
    const sink = createSink();
    installMediaHook(page.globals, { hideCodecs: false }, sink);
    const source = new page.FakeMediaSource();
    source.duration = 125.5;
    const buffer = source.addSourceBuffer('video/mp4');
    const data = new Uint8Array([1, 2, 3, 4]);

    buffer.appendBuffer(data);
    data[0] = 99;

    expect(page.appended).toHaveLength(1);
    expect(sink.appended).toHaveBeenCalledTimes(1);
    const event = sink.appended.mock.calls[0]?.[0];
    expect(event?.bufferId).toBe(1);
    expect(event?.durationSeconds).toBe(125.5);
    expect(Array.from(event?.bytes ?? [])).toEqual([1, 2, 3, 4]);
  });

  test.each([[Number.NaN], [Number.POSITIVE_INFINITY]])('a video length of %s is reported as unknown', (duration) => {
    const page = createPage();
    const sink = createSink();
    installMediaHook(page.globals, { hideCodecs: false }, sink);
    const source = new page.FakeMediaSource();
    source.duration = duration;

    source.addSourceBuffer('video/mp4').appendBuffer(new Uint8Array(2));

    expect(sink.appended.mock.calls[0]?.[0].durationSeconds).toBeUndefined();
  });

  test('copies only the part of an ArrayBuffer that a view covers', () => {
    const page = createPage();
    const sink = createSink();
    installMediaHook(page.globals, { hideCodecs: false }, sink);
    const whole = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

    new page.FakeMediaSource().addSourceBuffer('video/mp4').appendBuffer(new Uint8Array(whole.buffer, 2, 3));

    expect(Array.from(sink.appended.mock.calls[0]?.[0].bytes ?? [])).toEqual([2, 3, 4]);
  });

  test('copies a plain ArrayBuffer', () => {
    const page = createPage();
    const sink = createSink();
    installMediaHook(page.globals, { hideCodecs: false }, sink);

    new page.FakeMediaSource().addSourceBuffer('video/mp4').appendBuffer(new Uint8Array([5, 6]).buffer);

    expect(Array.from(sink.appended.mock.calls[0]?.[0].bytes ?? [])).toEqual([5, 6]);
  });

  test('a sink that throws never reaches the page: the buffer is still added and the data still appended', () => {
    const page = createPage();
    const sink = createSink();
    sink.bufferAdded.mockImplementation(() => {
      throw new Error('sink is broken');
    });
    sink.appended.mockImplementation(() => {
      throw new Error('sink is broken');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installMediaHook(page.globals, { hideCodecs: false }, sink);

    const buffer = new page.FakeMediaSource().addSourceBuffer('video/mp4');
    buffer.appendBuffer(new Uint8Array(3));

    expect(page.appended).toHaveLength(1);
  });
});

describe('installMediaHook: encrypted media', () => {
  test('reports the request for a key system and passes it on', async () => {
    const page = createPage();
    const sink = createSink();
    installMediaHook(page.globals, { hideCodecs: false }, sink);

    const access = await page.globals.navigator?.requestMediaKeySystemAccess?.('com.widevine.alpha', []);

    expect(access).toEqual({ keySystem: 'com.widevine.alpha' });
    expect(page.accessRequests).toEqual(['com.widevine.alpha']);
    expect(sink.encryptedMediaUsed).toHaveBeenCalledWith('requestMediaKeySystemAccess');
  });

  test('reports setMediaKeys and passes it on', async () => {
    const page = createPage();
    const sink = createSink();
    installMediaHook(page.globals, { hideCodecs: false }, sink);
    const keys = { id: 'keys' };

    await new page.FakeMediaElement().setMediaKeys(keys);

    expect(page.keysSet).toEqual([keys]);
    expect(sink.encryptedMediaUsed).toHaveBeenCalledWith('setMediaKeys');
  });
});

describe('installMediaHook: a page without parts of the pipeline', () => {
  test('does nothing and does not fail on an empty page', () => {
    expect(() => installMediaHook({}, { hideCodecs: true }, createSink())).not.toThrow();
  });

  test('works on a page without media capabilities and without encrypted media', () => {
    const page = createPage({ withCapabilities: false, withEncryption: false });
    const sink = createSink();

    installMediaHook(page.globals, { hideCodecs: true }, sink);
    new page.FakeMediaSource().addSourceBuffer('video/mp4').appendBuffer(new Uint8Array(1));

    expect(sink.appended).toHaveBeenCalledTimes(1);
  });
});
