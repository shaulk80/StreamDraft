// Spike driver (throwaway). Usage: node spikes/storage/run.ts <firefox|chrome> <mb> [mode,mode]
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Builder } from 'selenium-webdriver';
import * as firefox from 'selenium-webdriver/firefox.js';
import { CdpConnection } from '../../tests/smoke/cdp.ts';

const here = import.meta.dirname;
const CHUNK = 8 * 1024 * 1024;
const FIXED_UUID = 'a1b2c3d4-0000-4000-8000-00000000abcd';
const ADDON_ID = 'spike@streamdraft.test';
const TIMEOUT_MS = 10 * 60 * 1000;

const [, , browserName = 'firefox', mbText = '64', modeText] = process.argv;
const mb = Number(mbText);
const modes = (modeText ?? (browserName === 'firefox' ? 'page,background' : 'page,offscreen')).split(',');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- memory: working set of a process tree, in MiB
interface Proc {
  pid: number;
  ppid: number;
  name: string;
  ws: number;
}

function processes(): Proc[] {
  const text = execFileSync('wmic', ['process', 'get', 'Name,ParentProcessId,ProcessId,WorkingSetSize', '/format:csv'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows: Proc[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().split(',');
    if (cells.length < 5 || cells[0] === 'Node') {
      continue;
    }
    rows.push({ name: cells[1] ?? '', ppid: Number(cells[2]), pid: Number(cells[3]), ws: Number(cells[4]) });
  }
  return rows;
}

function treeMb(rootNames: string[], rootPid?: number): number {
  const all = processes();
  const roots =
    rootPid === undefined ? all.filter((p) => rootNames.includes(p.name.toLowerCase())).map((p) => p.pid) : [rootPid];
  const inTree = new Set<number>(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of all) {
      if (!inTree.has(p.pid) && inTree.has(p.ppid)) {
        inTree.add(p.pid);
        grew = true;
      }
    }
  }
  return Math.round(all.filter((p) => inTree.has(p.pid)).reduce((sum, p) => sum + p.ws, 0) / 1048576);
}

// ---- verification of the downloaded file
function expectedHash(totalBytes: number): string {
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(CHUNK);
  let written = 0;
  let index = 0;
  while (written < totalBytes) {
    const size = Math.min(CHUNK, totalBytes - written);
    for (let i = 0; i < size; i += 1) {
      chunk[i] = (i + index) & 255;
    }
    hash.update(size === CHUNK ? chunk : chunk.subarray(0, size));
    written += size;
    index += 1;
  }
  return hash.digest('hex');
}

function fileHash(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (data) => hash.update(data))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function measure(rootNames: string[], rootPid: number | undefined, run: () => Promise<Record<string, unknown>>) {
  const baseline = treeMb(rootNames, rootPid);
  let peak = baseline;
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      peak = Math.max(peak, treeMb(rootNames, rootPid));
      await sleep(700);
    }
  })();
  const started = Date.now();
  const result = await run();
  stop = true;
  await sampler;
  return { ...result, totalMs: Date.now() - started, baselineMb: baseline, peakMb: peak, growthMb: peak - baseline };
}

async function verify(downloadDir: string, result: Record<string, unknown>, expected: string): Promise<Record<string, unknown>> {
  const file = path.join(downloadDir, String(result['name']));
  // The browser may still be flushing the file when it reports completion.
  await sleep(1000);
  if (!existsSync(file)) {
    return { ...result, fileFound: false };
  }
  const size = statSync(file).size;
  const same = (await fileHash(file)) === expected;
  rmSync(file, { force: true });
  return { ...result, fileFound: true, fileSize: size, hashMatches: same };
}

function prepare(manifest: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spike-ext-'));
  cpSync(path.join(here, 'ext'), dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), readFileSync(path.join(here, 'ext', manifest)));
  return dir;
}

async function runFirefox(): Promise<void> {
  const extDir = prepare('manifest.firefox.json');
  const downloadDir = mkdtempSync(path.join(tmpdir(), 'spike-dl-'));
  const options = new firefox.Options();
  options.addArguments('-headless');
  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: FIXED_UUID }));
  options.setPreference('browser.download.folderList', 2);
  options.setPreference('browser.download.dir', downloadDir);
  options.setPreference('browser.download.useDownloadDir', true);
  options.setBinary(process.env['FIREFOX_BIN'] ?? 'C:\\Program Files\\Firefox Developer Edition\\firefox.exe');
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  const driver = (await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build()) as firefox.Driver;
  const expected = expectedHash(mb * 1024 * 1024);
  try {
    await driver.installAddon(extDir, true);
    for (const mode of modes) {
      const url = `moz-extension://${FIXED_UUID}/spike.html?mode=${mode}&mb=${mb}`;
      const result = await measure(['geckodriver.exe'], undefined, async () => {
        const before = await driver.getAllWindowHandles();
        await driver.setContext(firefox.Context.CHROME);
        await driver.executeScript(
          `const t = window.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); window.gBrowser.selectedTab = t;`,
          url,
        );
        await driver.setContext(firefox.Context.CONTENT);
        const handle = (await driver.getAllWindowHandles()).find((candidate) => !before.includes(candidate));
        await driver.switchTo().window(handle as string);
        const deadline = Date.now() + TIMEOUT_MS;
        while (Date.now() < deadline) {
          const text = (await driver.executeScript(
            `return document.body && document.body.dataset.done ? document.getElementById('out').textContent : null`,
          )) as string | null;
          if (text) {
            return JSON.parse(text) as Record<string, unknown>;
          }
          await sleep(500);
        }
        return { error: 'timeout' };
      });
      console.log('RESULT', JSON.stringify(await verify(downloadDir, result, expected)));
    }
  } finally {
    await driver.quit();
    rmSync(downloadDir, { recursive: true, force: true, maxRetries: 5 });
    rmSync(extDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function runChrome(): Promise<void> {
  const extDir = prepare('manifest.chrome.json');
  const workDir = mkdtempSync(path.join(tmpdir(), 'spike-chrome-'));
  const profileDir = path.join(workDir, 'profile');
  const downloadDir = path.join(workDir, 'downloads');
  mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
  mkdirSync(downloadDir);
  writeFileSync(
    path.join(profileDir, 'Default', 'Preferences'),
    JSON.stringify({ download: { default_directory: downloadDir, prompt_for_download: false } }),
  );
  const chromePath = process.env['CHROME_BIN'] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const expected = expectedHash(mb * 1024 * 1024);
  let browser: CdpConnection | undefined;
  try {
    const portFile = path.join(profileDir, 'DevToolsActivePort');
    while (!existsSync(portFile) || !readFileSync(portFile, 'utf8').includes('\n')) {
      await sleep(200);
    }
    const port = Number.parseInt(readFileSync(portFile, 'utf8').split('\n')[0] ?? '', 10);
    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
    const connection = await CdpConnection.connect(version.webSocketDebuggerUrl);
    browser = connection;
    const { id } = await connection.send<{ id: string }>('Extensions.loadUnpacked', { path: extDir });
    await sleep(2000);
    for (const mode of modes) {
      const url = `chrome-extension://${id}/spike.html?mode=${mode}&mb=${mb}`;
      const result = await measure(['chrome.exe'], chrome.pid, async () => {
        const { targetId } = await connection.send<{ targetId: string }>('Target.createTarget', { url });
        const { sessionId } = await connection.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
        const deadline = Date.now() + TIMEOUT_MS;
        while (Date.now() < deadline) {
          const answer = await connection.send<{ result: { value?: string } }>(
            'Runtime.evaluate',
            {
              expression: `document.body && document.body.dataset.done ? document.getElementById('out').textContent : ''`,
              returnByValue: true,
            },
            sessionId,
          );
          if (answer.result.value) {
            return JSON.parse(answer.result.value) as Record<string, unknown>;
          }
          await sleep(500);
        }
        return { error: 'timeout' };
      });
      console.log('RESULT', JSON.stringify(await verify(downloadDir, result, expected)));
    }
  } finally {
    browser?.close();
    chrome.kill();
    await sleep(1500);
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5 });
    rmSync(extDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

await (browserName === 'chrome' ? runChrome() : runFirefox());
