// MAIN world, document_start. Spike: wraps the media pipeline of the page and offers a transfer test.
(() => {
  const params = new URLSearchParams(location.search);
  const hide = params.get('hide') === '1';
  const hook = {
    // (b) was the hook here before the page's first script ran?
    scriptsAtStart: document.scripts.length,
    readyStateAtStart: document.readyState,
    hide,
    asked: [],
    buffers: [],
    appends: 0,
    appendedBytes: 0,
    eme: [],
  };
  window.__hook = hook;

  const HIDDEN = /webm|vp0?[89]|av01|av1/i;
  const isHidden = (type) => hide && typeof type === 'string' && HIDDEN.test(type);

  const origIsTypeSupported = MediaSource.isTypeSupported.bind(MediaSource);
  MediaSource.isTypeSupported = function isTypeSupported(type) {
    const answer = isHidden(type) ? false : origIsTypeSupported(type);
    hook.asked.push(['isTypeSupported', type, answer]);
    return answer;
  };

  const origCanPlayType = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function canPlayType(type) {
    const answer = isHidden(type) ? '' : origCanPlayType.call(this, type);
    hook.asked.push(['canPlayType', type, answer]);
    return answer;
  };

  if (navigator.mediaCapabilities) {
    const origDecodingInfo = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
    navigator.mediaCapabilities.decodingInfo = function decodingInfo(config) {
      const type = config?.video?.contentType ?? config?.audio?.contentType;
      if (isHidden(type)) {
        hook.asked.push(['decodingInfo', type, false]);
        return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
      }
      return origDecodingInfo(config).then((info) => {
        hook.asked.push(['decodingInfo', type, info.supported]);
        return info;
      });
    };
  }

  const origAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function addSourceBuffer(mime) {
    const buffer = origAddSourceBuffer.call(this, mime);
    hook.buffers.push({ mime, buffer });
    return buffer;
  };

  const origAppend = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function appendBuffer(data) {
    hook.appends += 1;
    hook.appendedBytes += data.byteLength;
    return origAppend.call(this, data);
  };

  const origRequest = navigator.requestMediaKeySystemAccess?.bind(navigator);
  if (origRequest) {
    navigator.requestMediaKeySystemAccess = function requestMediaKeySystemAccess(keySystem, configs) {
      hook.eme.push(['requestMediaKeySystemAccess', keySystem]);
      return origRequest(keySystem, configs);
    };
  }
  const origSetMediaKeys = HTMLMediaElement.prototype.setMediaKeys;
  if (origSetMediaKeys) {
    HTMLMediaElement.prototype.setMediaKeys = function setMediaKeys(keys) {
      hook.eme.push(['setMediaKeys']);
      return origSetMediaKeys.call(this, keys);
    };
  }

  // (c) take everything the player has buffered out again.
  window.__hookReset = async () => {
    for (const { buffer } of hook.buffers) {
      if (buffer.updating) {
        await new Promise((resolve) => buffer.addEventListener('updateend', resolve, { once: true }));
      }
      buffer.remove(0, Infinity);
      await new Promise((resolve) => buffer.addEventListener('updateend', resolve, { once: true }));
    }
  };

  // (a) send `mib` MiB in chunks of `chunkKib` KiB to the extension, as the page would hand over recorded media.
  // At most WINDOW chunks are on their way; the next one is made when the extension has taken one.
  const WINDOW = 8;
  window.__hookTransfer = (mib, chunkKib, paceMs = 0, stage = 'full') =>
    new Promise((resolve) => {
      const total = Math.ceil((mib * 1024) / chunkKib);
      let next = 0;
      let inFlight = 0;
      let stalled = false;
      const sendOne = () => {
        const buffer = new ArrayBuffer(chunkKib * 1024);
        const bytes = new Uint8Array(buffer);
        bytes[0] = next & 255;
        bytes[bytes.length - 1] = (next * 7) & 255;
        window.postMessage({ channel: 'spike-chunk', seq: next, buffer }, '*', [buffer]);
        next += 1;
        inFlight += 1;
      };
      // One chunk every paceMs (the speed of a network); never more than WINDOW on their way.
      const pump = () => {
        stalled = false;
        if (next >= total) {
          return;
        }
        if (inFlight >= WINDOW) {
          stalled = true;
          return;
        }
        sendOne();
        setTimeout(pump, paceMs);
      };
      const onMessage = (event) => {
        if (event.source !== window) {
          return;
        }
        if (event.data?.channel === 'spike-ready') {
          pump();
        }
        if (event.data?.channel === 'spike-ack') {
          inFlight -= 1;
          if (stalled) {
            pump();
          }
        }
        if (event.data?.channel === 'spike-done') {
          window.removeEventListener('message', onMessage);
          resolve(event.data.stats);
        }
      };
      window.addEventListener('message', onMessage);
      window.postMessage({ channel: 'spike-start', total, chunkBytes: chunkKib * 1024, stage }, '*');
    });
})();
