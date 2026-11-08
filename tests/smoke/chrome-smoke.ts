import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestPageServer } from '../pages/server.ts';
import { CdpConnection } from './cdp.ts';
import { extract, packageDir, readVersion } from './package-files.ts';
import {
  AUDIO_FILE_COUNT,
  audioFileNames,
  audioFilesProblem,
  dashFileProblem,
  DASH_FILE_NAME,
  hlsFileProblem,
  HLS_FILE_NAME,
  saveSoundScript,
  STREAM_PAGE,
} from './stream-download.ts';
import { checkJobDisplay, JOBS_PAGE, savedTextProblem, type PopupPage } from './job-display.ts';

// Smoke test of the Chrome PACKAGE in a real (headless) Chrome:
//   1. unpack the zip and load it as an unpacked extension (Extensions.loadUnpacked);
//   2. the background service worker runs;
//   3. the popup lists what detection found on a test page (page scan and network
//      observer), and its Download button saves a file;
//   4. the in-page button on a second test page saves a file.
// Chrome is driven over the DevTools protocol (no chromedriver). Without a Chrome
// binary the test is skipped with a warning; set CHROME_BIN to choose one. The
// right-click menu cannot be operated in headless Chrome and is checked in Firefox only.

const WAIT_MS = 20_000;
const POLL_MS = 200;
const LISTENER_SETTLE_MS = 3000;
const CHROME_LOCATIONS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const EXPECTED_FILES = ['clip.webm', 'direct.mp4', 'hidden-stream', 'late.mp4', 'song.mp3'];
const FILES_IN_THE_PAGE = ['clip.webm', 'direct.mp4', 'late.mp4', 'song.mp3'];
const PAGE_TITLE = 'StreamDraft detection test page';
const DOWNLOADED_NAME = 'StreamDraft detection test page [original].mp4';
const OVERLAY_NAME = 'StreamDraft test page [original].mp4';
const FILE_SIZE = 300 * 1024;

const problems: string[] = [];

function findChrome(): string | undefined {
  const fromEnvironment = process.env['CHROME_BIN'];
  if (fromEnvironment) {
    return fromEnvironment;
  }
  return CHROME_LOCATIONS.find((location) => existsSync(location));
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Polls until `check` gives a value that is not undefined; undefined after the time is up. */
async function waitFor<T>(check: () => Promise<T | undefined> | T | undefined): Promise<T | undefined> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) {
      return value;
    }
    await sleep(POLL_MS);
  }
  return undefined;
}

interface TargetInfo {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

async function listTargets(port: number): Promise<TargetInfo[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return (await response.json()) as TargetInfo[];
}

async function readDebuggingPort(profileDir: string): Promise<number | undefined> {
  // With --remote-debugging-port=0 Chrome writes the port it got into this file.
  return waitFor(() => {
    const file = path.join(profileDir, 'DevToolsActivePort');
    if (!existsSync(file)) {
      return undefined;
    }

    // Chrome may still hold the file open while writing it (EBUSY on Windows): try again on the next poll.
    // If it never becomes readable, the caller reports that the port did not open.
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    const port = Number.parseInt(text.split('\n')[0] ?? '', 10);
    return Number.isInteger(port) ? port : undefined;
  });
}

/** A page of the browser that can be asked questions. */
class Page {
  private readonly browser: CdpConnection;
  private readonly sessionId: string;

  constructor(browser: CdpConnection, sessionId: string) {
    this.browser = browser;
    this.sessionId = sessionId;
  }

  static async open(browser: CdpConnection, url: string): Promise<Page> {
    const { targetId } = await browser.send<{ targetId: string }>('Target.createTarget', { url });
    const { sessionId } = await browser.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    return new Page(browser, sessionId);
  }

  /** Runs a JavaScript expression in the page and gives its (JSON) value. */
  async evaluate<T>(expression: string): Promise<T | undefined> {
    const answer = await this.browser.send<{ result: { value?: T }; exceptionDetails?: unknown }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    return answer.exceptionDetails === undefined ? answer.result.value : undefined;
  }
}

async function listedFileNames(popup: Page): Promise<string> {
  const texts = await popup.evaluate<string[]>(
    "[...document.querySelectorAll('#media-list .meta')].map((meta) => meta.textContent)",
  );
  return (texts ?? [])
    .map((text) => text.split(' \u00b7 ').pop() ?? '')
    .sort()
    .join(', ');
}

// HLS and DASH: the page loads a master playlist, one of its rendition playlists (which must
// not be listed) and a DASH manifest. The popup reads the manifests when it opens and offers
// their qualities.
const EXPECTED_STREAM_CARDS = [
  { meta: '127.0.0.1 · DASH stream · mp4', options: ['720p (8.9 MB)', '360p (2.9 MB)', 'Audio only (234 KB)'] },
  { meta: '127.0.0.1 · HLS stream · mp4', options: ['720p', '360p', 'Audio only'] },
];

async function streamCards(popup: Page): Promise<string> {
  const cards = await popup.evaluate<{ meta: string; options: string[] }[]>(
    "[...document.querySelectorAll('#media-list .card')].map((card) => ({ meta: card.querySelector('.meta')?.textContent ?? '', options: [...card.querySelectorAll('.quality option')].map((option) => option.textContent) }))",
  );
  return JSON.stringify([...(cards ?? [])].sort((left, right) => left.meta.localeCompare(right.meta)));
}

async function checkStreams(browser: CdpConnection, extensionId: string, pageUrl: string): Promise<void> {
  const page = await Page.open(browser, `${pageUrl}streams.html`);
  const fetched = await waitFor(async () =>
    (await page.evaluate<string>("document.getElementById('fetch-status')?.textContent ?? ''"))?.includes('fetched')
      ? true
      : undefined,
  );
  if (!fetched) {
    problems.push('chrome runtime: the streams test page did not finish loading');
    return;
  }

  const pattern = encodeURIComponent('http://127.0.0.1/streams.html*');
  const popup = await Page.open(browser, `chrome-extension://${extensionId}/popup.html?tabUrl=${pattern}`);
  const expected = JSON.stringify(EXPECTED_STREAM_CARDS);
  const listed = await waitFor(async () => ((await streamCards(popup)) === expected ? true : undefined));
  if (!listed) {
    problems.push(`chrome runtime: streams: expected ${expected}, popup shows ${await streamCards(popup)}`);
    return;
  }
  console.log('Chrome runtime: streams: the HLS master and the DASH manifest are read when the popup opens and list their qualities; the rendition playlist is not listed');
}

// The page has two small streams with real segments (tests/pages/generated-stream.ts). Download on
// each card must fetch the parts, join them into one MP4 in the offscreen document and save it.
async function checkStreamDownloads(browser: CdpConnection, port: number, extensionId: string, pageUrl: string, downloadDir: string): Promise<void> {
  const offscreenOpen = async (): Promise<boolean> => (await listTargets(port)).some((target) => target.url === `chrome-extension://${extensionId}/offscreen.html`);
  const page = await Page.open(browser, `${pageUrl}${STREAM_PAGE}`);
  const fetched = await waitFor(async () =>
    (await page.evaluate<string>("document.getElementById('fetch-status')?.textContent ?? ''"))?.includes('fetched')
      ? true
      : undefined,
  );
  if (!fetched) {
    problems.push('chrome runtime: the stream download test page did not finish loading');
    return;
  }

  const pattern = encodeURIComponent(`http://127.0.0.1/${STREAM_PAGE}*`);
  const popup = await Page.open(browser, `chrome-extension://${extensionId}/popup.html?tabUrl=${pattern}`);
  const listed = await waitFor(async () =>
    (await popup.evaluate<number>("document.querySelectorAll('#media-list .download').length")) === 2 ? true : undefined,
  );
  if (!listed) {
    problems.push('chrome runtime: stream download: the popup did not list two streams with qualities');
    return;
  }

  await popup.evaluate("(() => { for (const button of document.querySelectorAll('#media-list .download')) { button.click(); } })()");
  const expected = [DASH_FILE_NAME, HLS_FILE_NAME];
  let sawOffscreen = false;
  const saved = await waitFor(async () => {
    sawOffscreen ||= await offscreenOpen();
    return expected.every((name) => existsSync(path.join(downloadDir, name))) ? true : undefined;
  });
  if (!saved) {
    problems.push(`chrome runtime: stream download: expected [${expected.join(', ')}] in the download folder, found [${readdirSync(downloadDir).join(', ')}]`);
    return;
  }

  const found = [dashFileProblem(path.join(downloadDir, DASH_FILE_NAME)), hlsFileProblem(path.join(downloadDir, HLS_FILE_NAME))].filter((problem) => problem !== undefined);
  found.forEach((problem) => problems.push(`chrome runtime: stream download: ${problem}`));

  // The browser has saved both files: the engine drops their temporary files and the offscreen document closes.
  const closed = await waitFor(async () => ((await offscreenOpen()) ? undefined : true));
  if (!closed) {
    problems.push('chrome runtime: stream download: the offscreen document stayed open after both files were saved');
  }
  if (found.length === 0 && closed) {
    console.log(`Chrome runtime: stream download: the DASH stream (picture and sound) and the HLS stream were fetched, joined in the offscreen document (seen open: ${String(sawOffscreen)}) and saved as readable MP4 files; the document closed afterwards`);
  }

  const unsaved = await savedTextProblem(
    {
      act: async () => undefined,
      read: (expression) => popup.evaluate<string>(expression),
      reload: async () => undefined,
    },
    expected.length,
  );
  if (unsaved !== undefined) {
    problems.push('chrome runtime: stream download: ' + unsaved);
  }

  await checkSoundDownloads(popup, offscreenOpen, downloadDir);
}

// The popup's job display: progress of a slow stream (also in a popup opened again), Cancel, and the
// words for a stream whose part is missing (tests/pages/jobs.html).
async function checkJobs(browser: CdpConnection, extensionId: string, pageUrl: string): Promise<void> {
  const page = await Page.open(browser, `${pageUrl}${JOBS_PAGE}`);
  const fetched = await waitFor(async () =>
    (await page.evaluate<string>("document.getElementById('fetch-status')?.textContent ?? ''"))?.includes('fetched') ? true : undefined,
  );
  if (!fetched) {
    problems.push('chrome runtime: the job display test page did not finish loading');
    return;
  }

  const pattern = encodeURIComponent(`http://127.0.0.1/${JOBS_PAGE}*`);
  const popupPage = await Page.open(browser, `chrome-extension://${extensionId}/popup.html?tabUrl=${pattern}`);
  const twoStreams = (): Promise<true | undefined> =>
    waitFor(async () => ((await popupPage.evaluate<number>("document.querySelectorAll('#media-list .download').length")) === 2 ? true : undefined));
  if (!(await twoStreams())) {
    problems.push('chrome runtime: job display: the popup did not list two streams with qualities');
    return;
  }

  const popup: PopupPage = {
    act: async (statements) => {
      await popupPage.evaluate(`(() => { ${statements} })()`);
    },
    read: (expression) => popupPage.evaluate<string>(expression),
    reload: async () => {
      await popupPage.evaluate('location.reload()');
      await twoStreams();
    },
  };
  const found = await checkJobDisplay(popup);
  found.forEach((problem) => problems.push(`chrome runtime: job display: ${problem}`));
  if (found.length === 0) {
    console.log('Chrome runtime: job display: a slow stream showed its progress (also in a popup opened again) and was cancelled, a stream with a missing part ended with the failure text');
  }
}

// "Audio only" on both cards: the DASH stream has a sound representation of its own, the HLS
// stream carries its sound inside the video segments and the engine takes it out.
async function checkSoundDownloads(popup: Page, offscreenOpen: () => Promise<boolean>, downloadDir: string): Promise<void> {
  for (let card = 0; card < AUDIO_FILE_COUNT; card++) {
    await popup.evaluate(`(() => { ${saveSoundScript(card)} })()`);
    const saved = await waitFor(async () => (audioFileNames(readdirSync(downloadDir)).length === card + 1 ? true : undefined));
    if (!saved) {
      problems.push(`chrome runtime: audio only: card ${card + 1} of ${AUDIO_FILE_COUNT}: no .m4a file arrived in the download folder, found [${readdirSync(downloadDir).join(', ')}]`);
      return;
    }
  }

  const problem = audioFilesProblem(downloadDir, audioFileNames(readdirSync(downloadDir)));
  if (problem !== undefined) {
    problems.push(`chrome runtime: audio only: ${problem}`);
    return;
  }

  const closed = await waitFor(async () => ((await offscreenOpen()) ? undefined : true));
  if (!closed) {
    problems.push('chrome runtime: audio only: the offscreen document stayed open after both files were saved');
    return;
  }
  console.log('Chrome runtime: audio only: the DASH sound and the sound cut out of the HLS video were saved as .m4a files with one sound track each');
}

async function checkDetectionAndDownload(
  browser: CdpConnection,
  extensionId: string,
  pageUrl: string,
  downloadDir: string,
): Promise<void> {
  const page = await Page.open(browser, `${pageUrl}detect.html`);
  const fetched = await waitFor(async () =>
    (await page.evaluate<string>("document.getElementById('fetch-status')?.textContent ?? ''"))?.includes('fetched')
      ? true
      : undefined,
  );
  if (!fetched) {
    problems.push('chrome runtime: the detection test page did not finish loading');
    return;
  }

  // Match patterns ignore the port.
  const pattern = encodeURIComponent('http://127.0.0.1/detect.html*');
  const popup = await Page.open(browser, `chrome-extension://${extensionId}/popup.html?tabUrl=${pattern}`);
  const expected = EXPECTED_FILES.join(', ');
  const listed = await waitFor(async () => ((await listedFileNames(popup)) === expected ? true : undefined));
  if (!listed) {
    problems.push(`chrome runtime: detection: expected [${expected}], popup lists [${await listedFileNames(popup)}]`);
    return;
  }
  // A file the network observer finds while the page loads is first named after the address
  // (the tab has no title yet); the title must catch up.
  const named = await waitFor(async () => {
    const titles = await popup.evaluate<string[]>(
      "[...document.querySelectorAll('#media-list .title')].map((title) => title.textContent)",
    );
    return titles?.length && titles.every((title) => title === PAGE_TITLE) ? true : undefined;
  });
  if (!named) {
    problems.push(`chrome runtime: detection: card titles should all be "${PAGE_TITLE}"`);
    return;
  }
  console.log(`Chrome runtime: detection lists ${EXPECTED_FILES.length} files for the test page (page scan and network observer), all named after the page`);

  await checkRefresh(popup);

  // Click Download on the card of direct.mp4.
  await popup.evaluate(`(() => {
    const cards = [...document.querySelectorAll('#media-list .card')];
    const card = cards.find((entry) => entry.querySelector('.meta')?.textContent?.endsWith('direct.mp4'));
    card?.querySelector('.download')?.click();
  })()`);
  const said = await waitFor(async () => {
    const text = await popup.evaluate<string>(
      "[...document.querySelectorAll('#media-list .result')].map((result) => result.textContent).join('')",
    );
    return text ? text : undefined;
  });
  if (!said?.includes(DOWNLOADED_NAME)) {
    problems.push(`chrome runtime: download: the popup said "${said ?? ''}"`);
    return;
  }
  await checkSavedFile(downloadDir, DOWNLOADED_NAME, 'popup Download');
}

// The Refresh button must bring back what the page itself has: the saved list is emptied
// (as if the background had lost it), then Refresh makes the page report its files again.
// hidden-stream only ever came from the network, so it stays gone: proof the page was scanned.
async function checkRefresh(popup: Page): Promise<void> {
  await popup.evaluate('chrome.storage.session.clear()');
  const emptied = await waitFor(async () => ((await listedFileNames(popup)) === '' ? true : undefined));
  if (!emptied) {
    problems.push('chrome runtime: refresh: the popup still lists files after the saved list was emptied');
    return;
  }

  await popup.evaluate("document.getElementById('refresh')?.click()");
  const wanted = FILES_IN_THE_PAGE.join(', ');
  const back = await waitFor(async () => ((await listedFileNames(popup)) === wanted ? true : undefined));
  if (!back) {
    problems.push(`chrome runtime: refresh: expected [${wanted}] after Refresh, popup lists [${await listedFileNames(popup)}]`);
    return;
  }
  const note = (await popup.evaluate<string>("document.getElementById('refresh-note')?.textContent ?? ''")) ?? '';
  if (!note.startsWith('Checked the page again. 4 videos listed.')) {
    problems.push(`chrome runtime: refresh: the note said "${note}"`);
    return;
  }
  console.log(`Chrome runtime: Refresh brought back the page's files after the saved list was emptied ("${note}")`);
}

async function checkOverlay(browser: CdpConnection, pageUrl: string, downloadDir: string): Promise<void> {
  const page = await Page.open(browser, pageUrl);
  const four = await waitFor(async () =>
    (await page.evaluate<number>("document.querySelectorAll('#streamdraft-overlay').length")) === 4 ? true : undefined,
  );
  if (!four) {
    problems.push('chrome runtime: overlay: expected 4 in-page buttons on the test page');
    return;
  }

  await page.evaluate(`(() => {
    const shadow = document.querySelector('#streamdraft-overlay')?.shadowRoot;
    shadow?.querySelector('.toggle')?.click();
    shadow?.querySelector('.download')?.click();
  })()`);
  const said = await waitFor(async () => {
    const text = await page.evaluate<string>(
      "document.querySelector('#streamdraft-overlay')?.shadowRoot?.querySelector('.result')?.textContent ?? ''",
    );
    return text ? text : undefined;
  });
  if (!said?.includes(OVERLAY_NAME)) {
    problems.push(`chrome runtime: overlay: the panel said "${said ?? ''}"`);
    return;
  }
  await checkSavedFile(downloadDir, OVERLAY_NAME, 'in-page button');
}

async function checkSavedFile(downloadDir: string, name: string, how: string): Promise<void> {
  const target = path.join(downloadDir, name);
  const saved = await waitFor(() => (existsSync(target) && statSync(target).size === FILE_SIZE ? true : undefined));
  if (!saved) {
    problems.push(`chrome runtime: ${how}: expected ${name} (${FILE_SIZE} bytes) in the download folder, found [${readdirSync(downloadDir).join(', ')}]`);
    return;
  }
  console.log(`Chrome runtime: ${how} saved "${name}" (${FILE_SIZE} bytes)`);
}

async function runChecks(chromePath: string, extensionDir: string, profileDir: string, downloadDir: string): Promise<void> {
  const chrome: ChildProcess = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const server = await startTestPageServer(0);
  let browser: CdpConnection | undefined;

  try {
    const port = await readDebuggingPort(profileDir);
    if (port === undefined) {
      problems.push('chrome runtime: Chrome did not open its debugging port');
      return;
    }

    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
    browser = await CdpConnection.connect(version.webSocketDebuggerUrl);

    // Chrome 137 and later ignore --load-extension; the protocol command still loads an unpacked folder.
    const { id: extensionId } = await browser.send<{ id: string }>('Extensions.loadUnpacked', { path: extensionDir });
    const worker = await waitFor(async () =>
      (await listTargets(port)).find((target) => target.url === `chrome-extension://${extensionId}/background.js`),
    );
    if (!worker) {
      problems.push('chrome runtime: the background service worker did not start');
      return;
    }
    console.log(`Chrome runtime: background service worker started (extension ${extensionId})`);

    // The worker target exists before Chrome has finished registering its webRequest listeners with
    // the browser; a page loaded in that gap would be missed by the network observer (on a slow CI
    // machine the test page's script-only file was, once). A real user installs the extension
    // before opening pages, so only the test needs the pause.
    await sleep(LISTENER_SETTLE_MS);

    await checkDetectionAndDownload(browser, extensionId, server.url, downloadDir);
    await checkStreams(browser, extensionId, server.url);
    await checkStreamDownloads(browser, port, extensionId, server.url, downloadDir);
    await checkJobs(browser, extensionId, server.url);
    await checkOverlay(browser, server.url, downloadDir);
  } catch (error) {
    console.error(error);
    problems.push('chrome runtime: a check failed (see the error above)');
  } finally {
    browser?.close();
    await server.close();
    chrome.kill();
  }
}

/**
 * Points Chrome's download folder at the test's folder, with no dialog. Done in the
 * profile (not with a DevTools command, which would also replace the file name the
 * extension asks for with the one from the address).
 */
function writeDownloadPreferences(profileDir: string, downloadDir: string): void {
  const defaultDir = path.join(profileDir, 'Default');
  mkdirSync(defaultDir, { recursive: true });
  const preferences = { download: { default_directory: downloadDir, prompt_for_download: false } };
  writeFileSync(path.join(defaultDir, 'Preferences'), JSON.stringify(preferences));
}

async function main(): Promise<void> {
  const chromePath = findChrome();
  if (chromePath === undefined) {
    console.warn('No Chrome found (set CHROME_BIN): the Chrome runtime check was skipped.');
    return;
  }

  const zipPath = path.join(packageDir, `streamdraft-${readVersion()}-chrome.zip`);
  const workDir = mkdtempSync(path.join(tmpdir(), 'streamdraft-chrome-smoke-'));
  const extensionDir = path.join(workDir, 'extension');
  const profileDir = path.join(workDir, 'profile');
  const downloadDir = path.join(workDir, 'downloads');
  mkdirSync(downloadDir);
  writeDownloadPreferences(profileDir, downloadDir);

  try {
    extract(zipPath, extensionDir);
    await runChecks(chromePath, extensionDir, profileDir, downloadDir);
  } finally {
    // Chrome may still be shutting down and holding files; the folder is in the temp folder anyway.
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5 });
  }

  if (problems.length > 0) {
    console.error('Chrome smoke test FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }
  console.log('Chrome smoke test OK.');
}

await main();
