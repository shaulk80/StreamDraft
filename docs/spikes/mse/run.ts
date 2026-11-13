// Spike runner: node run.ts <chrome|firefox> [transferMiB]
// Loads the spike extension (ext/) in headless Chrome (DevTools protocol) or Firefox (WebDriver) and runs the
// scenarios on mse.html: hook timing, codec hiding, EME sight, buffer reset, and a transfer of N MiB from the page
// to an extension page with the memory of the browser measured.
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Builder } from 'selenium-webdriver';
import * as firefox from 'selenium-webdriver/firefox.js';

const REPO = 'C:/Vibe/StreamDraft';
const { CdpConnection } = (await import(pathToFileURL(`${REPO}/tests/smoke/cdp.ts`).href)) as typeof import('C:/Vibe/StreamDraft/tests/smoke/cdp.ts');
const { MemorySampler } = (await import(pathToFileURL(`${REPO}/tests/smoke/memory-sampler.ts`).href)) as typeof import('C:/Vibe/StreamDraft/tests/smoke/memory-sampler.ts');

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const [, , browserName = 'chrome', transferArg = '256'] = process.argv;
const TRANSFER_MIB = Number(transferArg);
const CHUNK_KIB = Number(process.env['CHUNK_KIB'] ?? 1024);
/** Pause before the next chunk: media arrives at the speed of a network, not at the speed of memory. */
/** `full` (page to disk), `nowrite` (the extension page drops the data) or `relay` (the content script drops it). */
const STAGE = process.env['STAGE'] ?? 'full';
const PACE_MS = Number(process.env['PACE_MS'] ?? 0);
const FIXED_UUID = '0d9e2a30-3b8a-4c43-9a55-7d1f6c0e9b11';
const ADDON_ID = 'mse-spike@example.invalid';
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find((p) => existsSync(p));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/mse.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      createReadStream(path.join(here, 'mse.html')).pipe(response);
      return;
    }
    if (url.pathname.startsWith('/media/')) {
      const file = path.join(process.env['MEDIA_DIR'] ?? path.join(here, 'media'), path.basename(url.pathname));
      if (existsSync(file)) {
        response.setHeader('Content-Type', 'application/octet-stream');
        response.setHeader('Content-Length', String(statSync(file).size));
        createReadStream(file).pipe(response);
        return;
      }
    }
    response.statusCode = 404;
    response.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

/** One browser, however it is driven: open a page, evaluate in it, open the receiver page. */
interface Driver {
  open(url: string): Promise<Tab>;
  extensionUrl(file: string): string;
  close(): Promise<void>;
}
interface Tab {
  evaluate<T>(expression: string): Promise<T>;
}

async function chromeDriver(extensionDir: string): Promise<Driver> {
  if (!CHROME) {
    throw new Error('no Chrome');
  }
  const profile = mkdtempSync(path.join(tmpdir(), 'mse-spike-chrome-'));
  const chrome: ChildProcess = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 100 && !port; i += 1) {
    await sleep(200);
    const file = path.join(profile, 'DevToolsActivePort');
    if (existsSync(file)) {
      try {
        port = Number.parseInt(readFileSync(file, 'utf8').split('\n')[0] ?? '', 10) || 0;
      } catch {
        port = 0;
      }
    }
  }
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string; Browser: string };
  console.log('Chrome', version.Browser);
  const browser = await CdpConnection.connect(version.webSocketDebuggerUrl);
  const { id } = await browser.send<{ id: string }>('Extensions.loadUnpacked', { path: extensionDir });
  return {
    extensionUrl: (file) => `chrome-extension://${id}/${file}`,
    async open(url) {
      const { targetId } = await browser.send<{ targetId: string }>('Target.createTarget', { url });
      const { sessionId } = await browser.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
      return {
        async evaluate<T>(expression: string): Promise<T> {
          const answer = await browser.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
          if (answer.exceptionDetails) {
            throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
          }
          return answer.result.value as T;
        },
      };
    },
    async close() {
      browser.close();
      chrome.kill();
      await sleep(500);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

async function firefoxDriver(extensionDir: string): Promise<Driver> {
  const options = new firefox.Options();
  options.addArguments('-headless');
  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: FIXED_UUID }));
  options.setPreference('media.autoplay.default', 0);
  options.setPreference('media.autoplay.blocking_policy', 0);
  if (process.env['FIREFOX_BIN']) {
    options.setBinary(process.env['FIREFOX_BIN']);
  }
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  const driver = (await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build()) as firefox.Driver;
  console.log('Firefox', (await driver.getCapabilities()).get('browserVersion'));
  await driver.installAddon(extensionDir, true);

  async function openTab(url: string): Promise<string> {
    const before = await driver.getAllWindowHandles();
    await driver.setContext(firefox.Context.CHROME);
    try {
      await driver.executeScript('const tab = window.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); window.gBrowser.selectedTab = tab;', url);
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
    const handle = (await driver.getAllWindowHandles()).find((h) => !before.includes(h));
    if (!handle) {
      throw new Error('tab did not open');
    }
    return handle;
  }

  return {
    extensionUrl: (file) => `moz-extension://${FIXED_UUID}/${file}`,
    async open(url) {
      const handle = await openTab(url);
      return {
        async evaluate<T>(expression: string): Promise<T> {
          await driver.switchTo().window(handle);
          return driver.executeAsyncScript<T>(`const done = arguments[arguments.length - 1]; Promise.resolve(${expression}).then((value) => done(JSON.parse(JSON.stringify(value ?? null))), (error) => done({ __error: String(error) }));`);
        },
      };
    },
    async close() {
      await driver.quit();
    },
  };
}

async function waitDone(tab: Tab, seconds = 40): Promise<Record<string, unknown>> {
  for (let i = 0; i < seconds * 2; i += 1) {
    const result = await tab.evaluate<Record<string, unknown> | null>('window.__result && window.__result.done ? window.__result : null');
    if (result) {
      return result;
    }
    await sleep(500);
  }
  return { timedOut: true };
}

async function main(): Promise<void> {
  const extensionDir = mkdtempSync(path.join(tmpdir(), 'mse-spike-ext-'));
  const sourceDir = process.env['CHECK'] ? path.join(here, 'youtube-check', browserName) : path.join(here, 'ext');
  cpSync(sourceDir, extensionDir, { recursive: true });
  if (!process.env['CHECK']) {
    copyFileSync(path.join(sourceDir, browserName === 'chrome' ? 'manifest.chrome.json' : 'manifest.firefox.json'), path.join(extensionDir, 'manifest.json'));
  }
  const server = await startServer();
  const driver = browserName === 'chrome' ? await chromeDriver(extensionDir) : await firefoxDriver(extensionDir);
  try {
    await sleep(2500);
    if (process.env['CHECK']) {
      // The hand-check extension (youtube-check/), tried on the local page: report, then reset.
      const page = await driver.open(`${server.url}/mse.html?hide=0`);
      await waitDone(page);
      console.log(await page.evaluate<string>('window.__playerCheck.report()'));
      console.log(await page.evaluate<string>('window.__playerCheck.speed(4, 2)'));
      console.log(await page.evaluate<string>('window.__playerCheck.reset(2)'));
      return;
    }
    const receiver = await driver.open(driver.extensionUrl('receiver.html'));
    await sleep(500);

    for (const [label, query] of [['codecs shown', '?hide=0'], ['codecs hidden', '?hide=1'], ['EME used', '?hide=0&eme=1']] as const) {
      const tab = await driver.open(`${server.url}/mse.html${query}`);
      const result = await waitDone(tab);
      const hook = await tab.evaluate<Record<string, unknown>>('({ hookAppends: window.__hook?.appends, hookBytes: window.__hook?.appendedBytes, buffers: window.__hook?.buffers.map((b) => b.mime), eme: window.__hook?.eme, asked: window.__hook?.asked.length })');
      console.log(`\n== ${label} ==`);
      console.log(JSON.stringify({ ...result, hook }, null, 1));
      if (label === 'codecs shown') {
        console.log('refill:', JSON.stringify(await tab.evaluate('window.refill()')));
      }
    }

    console.log(`\n== transfer ${TRANSFER_MIB} MiB in ${CHUNK_KIB} KiB chunks ==`);
    const tab = await driver.open(`${server.url}/mse.html?hide=0`);
    await waitDone(tab);
    const sampler = new MemorySampler();
    await sampler.start();
    const started = Date.now();
    const stats = await tab.evaluate<Record<string, unknown>>(`window.__hookTransfer(${TRANSFER_MIB}, ${CHUNK_KIB}, ${PACE_MS}, '${STAGE}')`);
    const seconds = (Date.now() - started) / 1000;
    const memory = await sampler.stop();
    console.log(JSON.stringify({ stats, seconds, MiBperSecond: Math.round((TRANSFER_MIB / seconds) * 10) / 10, memory }, null, 1));
    // Garbage or kept? The memory ten seconds after the transfer ended.
    await sleep(10_000);
    const later = new MemorySampler();
    await later.start();
    console.log('memory 10 s after the end (MiB, compare with the baseline above):', (await later.stop()).baselineMib);
    void receiver;
  } finally {
    await driver.close();
    server.close();
    rmSync(extensionDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

await main();
