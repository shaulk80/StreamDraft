import { isHiddenMediaType } from './type-filter.ts';

/** What the hook tells the recorder. The hook passes copies of the bytes: the player may reuse its own. */
export interface HookSink {
  bufferAdded(event: { bufferId: number; sourceId: number; mime: string }): void;
  appended(event: { bufferId: number; bytes: Uint8Array; durationSeconds?: number }): void;
  encryptedMediaUsed(api: string): void;
}

export interface HookOptions {
  /** Tell the player the browser cannot play VP9, AV1 and WebM, so that it takes H.264 and AAC. */
  hideCodecs: boolean;
}

// The parts of the page's globals the hook replaces. Written as structural types so tests can pass
// plain objects; in the page the global `window` is passed.
interface MediaSourceInstance {
  addSourceBuffer(mime: string): object;
  duration: number;
}
interface SourceBufferInstance {
  appendBuffer(data: ArrayBuffer | ArrayBufferView): void;
}
interface MediaElementInstance {
  canPlayType(type: string): string;
  setMediaKeys?(keys: unknown): Promise<void>;
}
interface MediaCapabilitiesLike {
  decodingInfo(configuration: { video?: { contentType?: string }; audio?: { contentType?: string } }): Promise<{ supported: boolean; smooth?: boolean; powerEfficient?: boolean }>;
}
export interface PipelineGlobals {
  MediaSource?: { isTypeSupported(type: string): boolean; prototype: MediaSourceInstance };
  SourceBuffer?: { prototype: SourceBufferInstance };
  HTMLMediaElement?: { prototype: MediaElementInstance };
  navigator?: { requestMediaKeySystemAccess?(keySystem: string, configurations: unknown): Promise<unknown>; mediaCapabilities?: MediaCapabilitiesLike };
}

/** A copy of the bytes of an `ArrayBuffer` or a view on one. */
function copyOf(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  return new Uint8Array(data.slice(0));
}

/** Calls the sink; what the sink does wrong is logged and never reaches the page. */
function guarded(what: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    console.error(`StreamDraft: ${what} failed`, error);
  }
}

/**
 * Watches the media pipeline of a page: every source buffer the player opens
 * and every piece it appends, and its use of encrypted media. With
 * `hideCodecs` it also answers "no" when the player asks whether VP9, AV1 or
 * WebM can be played. The page's own results are passed through otherwise;
 * nothing the page can see is changed except those answers.
 * Whatever is missing in the page (no `MediaSource`, no `mediaCapabilities`)
 * is skipped.
 */
export function installMediaHook(globals: PipelineGlobals, options: HookOptions, sink: HookSink): void {
  const bufferIds = new WeakMap<object, number>();
  const sourceIds = new WeakMap<object, number>();
  // The media source a buffer belongs to, to read the length of the video when something is appended.
  const mediaSources = new WeakMap<object, MediaSourceInstance>();
  let nextBufferId = 1;
  let nextSourceId = 1;

  const { MediaSource: mediaSource, SourceBuffer: sourceBuffer, HTMLMediaElement: mediaElement, navigator: pageNavigator } = globals;

  if (mediaSource !== undefined) {
    const isTypeSupported = mediaSource.isTypeSupported.bind(mediaSource);
    mediaSource.isTypeSupported = (type: string): boolean => (options.hideCodecs && isHiddenMediaType(type) ? false : isTypeSupported(type));

    const addSourceBuffer = mediaSource.prototype.addSourceBuffer;
    mediaSource.prototype.addSourceBuffer = function (this: MediaSourceInstance, mime: string): object {
      const buffer = addSourceBuffer.call(this, mime);
      let sourceId = sourceIds.get(this);
      if (sourceId === undefined) {
        sourceId = nextSourceId;
        nextSourceId += 1;
        sourceIds.set(this, sourceId);
      }
      const bufferId = nextBufferId;
      nextBufferId += 1;
      bufferIds.set(buffer, bufferId);
      mediaSources.set(buffer, this);
      guarded('reporting a source buffer', () => sink.bufferAdded({ bufferId, sourceId, mime }));
      return buffer;
    };
  }

  if (sourceBuffer !== undefined) {
    const appendBuffer = sourceBuffer.prototype.appendBuffer;
    sourceBuffer.prototype.appendBuffer = function (this: SourceBufferInstance, data: ArrayBuffer | ArrayBufferView): void {
      const bufferId = bufferIds.get(this);
      if (bufferId !== undefined) {
        guarded('reporting appended data', () => {
          const duration = mediaSources.get(this)?.duration;
          sink.appended({ bufferId, bytes: copyOf(data), durationSeconds: duration !== undefined && Number.isFinite(duration) ? duration : undefined });
        });
      }
      appendBuffer.call(this, data);
    };
  }

  if (mediaElement !== undefined) {
    const canPlayType = mediaElement.prototype.canPlayType;
    mediaElement.prototype.canPlayType = function (this: MediaElementInstance, type: string): string {
      return options.hideCodecs && isHiddenMediaType(type) ? '' : canPlayType.call(this, type);
    };

    const setMediaKeys = mediaElement.prototype.setMediaKeys;
    if (setMediaKeys !== undefined) {
      mediaElement.prototype.setMediaKeys = function (this: MediaElementInstance, keys: unknown): Promise<void> {
        guarded('reporting encrypted media', () => sink.encryptedMediaUsed('setMediaKeys'));
        return setMediaKeys.call(this, keys);
      };
    }
  }

  if (pageNavigator?.requestMediaKeySystemAccess !== undefined) {
    const request = pageNavigator.requestMediaKeySystemAccess.bind(pageNavigator);
    pageNavigator.requestMediaKeySystemAccess = (keySystem: string, configurations: unknown): Promise<unknown> => {
      guarded('reporting encrypted media', () => sink.encryptedMediaUsed('requestMediaKeySystemAccess'));
      return request(keySystem, configurations);
    };
  }

  const capabilities = pageNavigator?.mediaCapabilities;
  if (capabilities !== undefined) {
    const decodingInfo = capabilities.decodingInfo.bind(capabilities);
    capabilities.decodingInfo = (configuration): ReturnType<MediaCapabilitiesLike['decodingInfo']> => {
      const type = configuration.video?.contentType ?? configuration.audio?.contentType;
      if (options.hideCodecs && isHiddenMediaType(type)) {
        return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
      }
      return decodingInfo(configuration);
    };
  }
}
