// Spike: does a real browser play the file? Usage: node play-check.ts <chrome|firefox> <file> [file...]
// Serves the files over http with Range support, loads each in a <video>, plays muted for 3 s,
// then seeks to the middle, and reports duration, size, decoded frames and the time reached.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Builder } from 'selenium-webdriver';
import * as firefox from 'selenium-webdriver/firefox.js';
import { CdpConnection } from '../../tests/smoke/cdp.ts';

const [, , browserName = 'chrome', ...files] = process.argv;

const PAGE = `<!doctype html><meta charset=utf-8><body></body>`;

const CHECK = `(async (name) => {
  const video = document.createElement('video');
  video.muted = true;
  video.src = '/' + name;
  document.body.append(video);
  const wait = (event) => new Promise((resolve) => video.addEventListener(event, resolve, { once: true }));
  const result = { name };
  try {
    await Promise.race([wait('loadedmetadata'), new Promise((_, reject) => setTimeout(() => reject(new Error('no metadata')), 10000))]);
    result.duration = video.duration;
    result.width = video.videoWidth;
    result.height = video.videoHeight;
    await video.play();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    result.timeAfter3s = Math.round(video.currentTime * 10) / 10;
    const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    result.frames = quality ? quality.totalVideoFrames : null;
    result.dropped = quality ? quality.droppedVideoFrames : null;
    result.audioTracks = video.audioTracks ? video.audioTracks.length : null;
    if (Number.isFinite(video.duration)) {
      const target = video.duration / 2;
      video.currentTime = target;
      await Promise.race([wait('seeked'), new Promise((_, reject) => setTimeout(() => reject(new Error('seek timed out')), 8000))]);
      result.seekedTo = Math.round(video.currentTime * 10) / 10;
    }
    result.audioDecodedBytes = video.webkitAudioDecodedByteCount ?? null;
    result.mozHasAudio = video.mozHasAudio ?? null;
    video.currentTime = 0;
    video.playbackRate = 16;
    await video.play();
    await Promise.race([wait('ended'), new Promise((resolve) => setTimeout(resolve, 40000))]);
    result.endedAt = Math.round(video.currentTime * 10) / 10;
    result.ended = video.ended;
  } catch (error) {
    result.error = String(error && error.message || error);
    result.mediaError = video.error ? video.error.message || video.error.code : null;
  }
  return JSON.stringify(result);
})`;

function serve(): Promise<{ port: number; close: () => void }> {
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? '/').slice(1));
    if (name === 'check.html') {
      response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
      return;
    }
    const file = files.find((candidate) => path.basename(candidate) === name);
    if (!file || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    const type = file.endsWith('.aac') ? 'audio/aac' : file.endsWith('.mp4') || file.endsWith('.m4a') ? (file.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4') : 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      response.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ port: address.port, close: () => server.close() });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runChrome(port: number): Promise<void> {
  const profileDir = mkdtempSync(path.join(tmpdir(), 'play-chrome-'));
  const chromePath = process.env['CHROME_BIN'] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chrome = spawn(
    chromePath,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--disable-gpu', 'about:blank'],
    { stdio: 'ignore' },
  );
  let connection: CdpConnection | undefined;
  try {
    const portFile = path.join(profileDir, 'DevToolsActivePort');
    while (!existsSync(portFile) || !readFileSync(portFile, 'utf8').includes('\n')) {
      await sleep(200);
    }
    const debugPort = Number.parseInt(readFileSync(portFile, 'utf8').split('\n')[0] ?? '', 10);
    const version = (await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()) as { webSocketDebuggerUrl: string };
    const browser = await CdpConnection.connect(version.webSocketDebuggerUrl);
    connection = browser;
    const { targetId } = await browser.send<{ targetId: string }>('Target.createTarget', { url: `http://127.0.0.1:${port}/check.html` });
    const { sessionId } = await browser.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    await sleep(500);
    for (const file of files) {
      const answer = await browser.send<{ result: { value?: string } }>(
        'Runtime.evaluate',
        { expression: `${CHECK}(${JSON.stringify(path.basename(file))})`, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      console.log('PLAY chrome', answer.result.value);
    }
  } finally {
    connection?.close();
    chrome.kill();
    await sleep(1500);
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function runFirefox(port: number): Promise<void> {
  const options = new firefox.Options();
  options.addArguments('-headless');
  options.setPreference('media.autoplay.default', 0);
  options.setBinary(process.env['FIREFOX_BIN'] ?? 'C:\\Program Files\\Firefox Developer Edition\\firefox.exe');
  const driver = (await new Builder().forBrowser('firefox').setFirefoxOptions(options).build()) as firefox.Driver;
  try {
    await driver.get(`http://127.0.0.1:${port}/check.html`);
    for (const file of files) {
      const value = await driver.executeAsyncScript(
        `const done = arguments[arguments.length - 1]; ${CHECK}(${JSON.stringify(path.basename(file))}).then(done);`,
      );
      console.log('PLAY firefox', value);
    }
  } finally {
    await driver.quit();
  }
}

const server = await serve();
try {
  await (browserName === 'firefox' ? runFirefox(server.port) : runChrome(server.port));
} finally {
  server.close();
}
