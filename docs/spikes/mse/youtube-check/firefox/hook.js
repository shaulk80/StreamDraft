// Spike for task 6 of M4: watches how a page's player uses the media pipeline, in the page's own world.
// Nothing leaves the page. Open the console on the page and call:
//   __playerCheck.report()          what the player asked and appended so far
//   __playerCheck.hide(true|false)  hide VP9/AV1/WebM from the player (takes effect after a reload)
//   __playerCheck.reset(seconds)    empty the player's buffers, go to 0:00 and count what it appends again
//   __playerCheck.speed(rate, seconds)  play at `rate` times the speed for `seconds` and say how far the video got
(() => {
  const state = {
    hookRanBeforePageScripts: document.scripts.length === 0,
    hiding: localStorage.getItem('sdHide') === '1',
    asked: new Map(),
    buffers: [],
    eme: [],
    mediaSourcesInWorkers: 'not visible from here',
  };
  const HIDDEN = /webm|vp0?[89]|av01|av1/i;
  const hidden = (type) => state.hiding && typeof type === 'string' && HIDDEN.test(type);
  const note = (kind, type, answer) => state.asked.set(`${kind} ${type}`, answer);

  const isTypeSupported = MediaSource.isTypeSupported.bind(MediaSource);
  MediaSource.isTypeSupported = (type) => {
    const answer = hidden(type) ? false : isTypeSupported(type);
    note('isTypeSupported', type, answer);
    return answer;
  };
  const canPlayType = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) {
    const answer = hidden(type) ? '' : canPlayType.call(this, type);
    note('canPlayType', type, answer);
    return answer;
  };
  if (navigator.mediaCapabilities) {
    const decodingInfo = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
    navigator.mediaCapabilities.decodingInfo = (config) => {
      const type = config?.video?.contentType ?? config?.audio?.contentType;
      if (hidden(type)) {
        note('decodingInfo', type, false);
        return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
      }
      return decodingInfo(config).then((info) => {
        note('decodingInfo', type, info.supported);
        return info;
      });
    };
  }

  const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mime) {
    const buffer = addSourceBuffer.call(this, mime);
    state.buffers.push({ mime, buffer, appends: 0, bytes: 0, initSegments: 0, sinceReset: 0 });
    return buffer;
  };
  const appendBuffer = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (data) {
    const entry = state.buffers.find((candidate) => candidate.buffer === this);
    if (entry) {
      entry.appends += 1;
      entry.sinceReset += 1;
      entry.bytes += data.byteLength;
      const head = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, Math.min(data.byteLength, 64));
      if (String.fromCharCode(...head).includes('ftyp') || String.fromCharCode(...head).includes('moov')) {
        entry.initSegments += 1;
      }
    }
    return appendBuffer.call(this, data);
  };

  const requestAccess = navigator.requestMediaKeySystemAccess?.bind(navigator);
  if (requestAccess) {
    navigator.requestMediaKeySystemAccess = (keySystem, configs) => {
      state.eme.push(`requestMediaKeySystemAccess ${keySystem}`);
      return requestAccess(keySystem, configs);
    };
  }
  const setMediaKeys = HTMLMediaElement.prototype.setMediaKeys;
  if (setMediaKeys) {
    HTMLMediaElement.prototype.setMediaKeys = function (keys) {
      state.eme.push('setMediaKeys');
      return setMediaKeys.call(this, keys);
    };
  }

  window.__playerCheck = {
    hide(on) {
      localStorage.setItem('sdHide', on ? '1' : '0');
      return `codec hiding ${on ? 'ON' : 'OFF'}; reload the page`;
    },
    report() {
      return JSON.stringify(
        {
          hookRanBeforePageScripts: state.hookRanBeforePageScripts,
          codecHiding: state.hiding,
          asked: Object.fromEntries(state.asked),
          buffers: state.buffers.map(({ mime, appends, bytes, initSegments }) => ({ mime, appends, MiB: Math.round(bytes / 1048576), initSegments })),
          eme: state.eme,
          video: [...document.querySelectorAll('video')].map((video) => ({ currentTime: Math.round(video.currentTime), buffered: [...Array(video.buffered.length).keys()].map((i) => [Math.round(video.buffered.start(i)), Math.round(video.buffered.end(i))]) })),
        },
        null,
        1,
      );
    },
    async speed(rate = 8, seconds = 15) {
      const video = document.querySelector('video');
      if (!video) {
        return 'no video element on the page';
      }
      const startedAt = video.currentTime;
      const appendsBefore = state.buffers.map((entry) => entry.appends);
      let rateChanges = 0;
      video.addEventListener('ratechange', () => (rateChanges += 1));
      video.playbackRate = rate;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return JSON.stringify({
        requestedRate: rate,
        rateAfterwards: video.playbackRate,
        rateChangeEvents: rateChanges,
        wallSeconds: seconds,
        videoSecondsPlayed: Math.round((video.currentTime - startedAt) * 10) / 10,
        paused: video.paused,
        appendsAdded: state.buffers.map((entry, index) => ({ mime: entry.mime, added: entry.appends - (appendsBefore[index] ?? 0) })),
        bufferedEnd: video.buffered.length > 0 ? Math.round(video.buffered.end(video.buffered.length - 1)) : null,
      });
    },
    async reset(seconds = 10) {
      const video = document.querySelector('video');
      for (const entry of state.buffers) {
        entry.sinceReset = 0;
        try {
          if (entry.buffer.updating) {
            await new Promise((resolve) => entry.buffer.addEventListener('updateend', resolve, { once: true }));
          }
          entry.buffer.remove(0, Infinity);
          await new Promise((resolve) => entry.buffer.addEventListener('updateend', resolve, { once: true }));
        } catch (error) {
          return `could not empty a buffer: ${error}`;
        }
      }
      if (video) {
        video.currentTime = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return JSON.stringify({
        waitedSeconds: seconds,
        appendsSinceReset: state.buffers.map(({ mime, sinceReset }) => ({ mime, sinceReset })),
        playing: video ? !video.paused : null,
        currentTime: video ? Math.round(video.currentTime) : null,
        bufferedStart: video && video.buffered.length > 0 ? Math.round(video.buffered.start(0)) : null,
      });
    },
  };
})();
