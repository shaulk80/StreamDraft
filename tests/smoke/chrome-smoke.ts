import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestPageServer } from '../pages/server.ts';
import { CdpConnection } from './cdp.ts';
import { extract, packageDir, readVersion } from './package-files.ts';

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
