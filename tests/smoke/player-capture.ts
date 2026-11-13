import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readFlatMp4 } from '../engine/flat-mp4-reader.ts';
import { ffprobeProblem } from './ffprobe.ts';
import { captureSettingScript, SETTING_SETTLE_MS } from './page-data.ts';

// The player capture end to end, checked the same way in Firefox (WebDriver) and Chrome (DevTools).
// /mse.html plays 12 seconds of real H.264 and AAC through Media Source Extensions. Switched on for the site and
// armed, the extension must hide VP9 from the player, record what the player appends in the page, and join it
// into the same kind of file as a stream download. The browsers differ only in how a page is opened and asked.

export const MSE_PAGE = 'mse.html';
export const MSE_TITLE = 'StreamDraft player capture test page';
export const MSE_VIDEO_FILE = `${MSE_TITLE} [original].mp4`;
export const MSE_SOUND_FILE = `${MSE_TITLE} [audio].m4a`;

/** 3 segments of 120 frames; 3 segments of 94 AAC frames. */
const PICTURE_SAMPLES = 360;
const SOUND_SAMPLES = 282;
const VP9 = 'video/webm; codecs="vp9"';
const LENGTH_SECONDS = 12;
/** The sound runs a little past the picture, and the player reports the longer. */
const LENGTH_TOLERANCE_SECONDS = 0.5;

const WAIT_MS = 20_000;
const POLL_MS = 250;
const SETTLED_MS = 1000;

/** What the two browsers do differently; everything else is shared. */
export interface CaptureSmokeBrowser {
  /** Which `browser`/`chrome` object an extension page has. */
  api: 'browser' | 'chrome';
  /** Opens the address in a new tab and makes it the page that `inTestPage` asks. */
  openTestPage(url: string): Promise<void>;
  /** Evaluates an expression in the test page's current document; undefined when it cannot be read (a page that is loading). */
  inTestPage(expression: string): Promise<unknown>;
  /** Runs an async script in an extension page and gives the text it returns. */
  inExtension(script: string): Promise<string | undefined>;
  sleep(milliseconds: number): Promise<void>;
}

interface CommandReply {
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface Snapshot {
  protected: boolean;
  durationSeconds?: number;
  complete: boolean;
  buffers: { kind: string; fragmentCount: number; stoppedBecause?: string }[];
  problems: string[];
}

interface PageResult {
  done: boolean;
  error: string | null;
  picked: string | null;
  loadId: string;
  isTypeSupported?: Record<string, boolean>;
}

/**
 * An extension-page script that sends a capture command about the newest tab showing the test page. The tab is
 * found by its address (the newest has the highest id), because a smoke test cannot know the tab's number.
 */
export function captureCommandScript(api: 'browser' | 'chrome', command: { kind: string; soundOnly?: boolean }): string {
  return `(async () => {
    const tabs = await ${api}.tabs.query({ url: 'http://127.0.0.1/${MSE_PAGE}*' });
    const tab = tabs.sort((first, second) => second.id - first.id)[0];
    if (tab === undefined) {
      return JSON.stringify({ ok: false, error: 'no tab shows the test page' });
    }
    const reply = await ${api}.runtime.sendMessage({ type: 'capture-command', command: { ...${JSON.stringify(command)}, tabId: tab.id } });
    return JSON.stringify(reply ?? { ok: false, error: 'no reply' });
  })()`;
}

async function waitUntil(browser: CaptureSmokeBrowser, check: () => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await browser.sleep(POLL_MS);
  }
  return false;
}

async function command(browser: CaptureSmokeBrowser, request: { kind: string; soundOnly?: boolean }): Promise<CommandReply> {
  const text = await browser.inExtension(captureCommandScript(browser.api, request));
  try {
    return JSON.parse(text ?? 'null') as CommandReply;
  } catch {
    return { ok: false, error: `no usable answer to ${request.kind}: ${String(text)}` };
  }
}

async function pageResult(browser: CaptureSmokeBrowser): Promise<PageResult | undefined> {
  const value = await browser.inTestPage('JSON.stringify(window.__result ?? null)');
  return typeof value === 'string' ? (JSON.parse(value) as PageResult | null) ?? undefined : undefined;
}

/** Waits for the test page to finish feeding its player; a different load than `previousLoad` when one is given. */
async function waitForPage(browser: CaptureSmokeBrowser, previousLoad?: string): Promise<PageResult | undefined> {
  let found: PageResult | undefined;
  await waitUntil(browser, async () => {
    const current = await pageResult(browser);
    found = current?.done === true && current.loadId !== previousLoad ? current : undefined;
    return found !== undefined;
  });
  return found;
}

async function statusOf(browser: CaptureSmokeBrowser): Promise<Snapshot | undefined> {
  const reply = await command(browser, { kind: 'status' });
  return reply.ok ? (reply.value as Snapshot) : undefined;
}

/** A file in the download folder that exists and has stopped growing. */
async function savedFile(browser: CaptureSmokeBrowser, folder: string, name: string): Promise<string | undefined> {
  const file = path.join(folder, name);
  let lastSize = -1;
  const stable = await waitUntil(browser, async () => {
    if (!existsSync(file)) {
      return false;
    }
    const size = statSync(file).size;
    const same = size > 0 && size === lastSize;
    lastSize = size;
    if (same) {
      await browser.sleep(SETTLED_MS);
      return statSync(file).size === size;
    }
    return false;
  });
  return stable ? file : undefined;
}

function samplesOf(file: string): string {
  const read = readFlatMp4(readFileSync(file));
  return JSON.stringify(read.tracks.map((track) => track.samples.length));
}

/** A problem text when the saved file is not the recorded picture and sound (or sound only), otherwise undefined. */
export function recordedFileProblem(file: string, expectedSamples: number[], expectedKinds: string[]): string | undefined {
  let samples: string;
  try {
    samples = samplesOf(file);
  } catch (error) {
    return `${path.basename(file)} is not a readable MP4: ${String(error)}`;
  }

  if (samples !== JSON.stringify(expectedSamples)) {
    return `${path.basename(file)} has tracks of ${samples} samples, expected ${JSON.stringify(expectedSamples)}`;
  }
  return ffprobeProblem(file, expectedKinds);
}

/** Opens the test page, arms the tab (which reloads it) and gives the finished load of the page. */
async function recordedLoad(browser: CaptureSmokeBrowser, pageUrl: string, query: string): Promise<{ page?: PageResult; problem?: string }> {
  await browser.openTestPage(`${pageUrl}${MSE_PAGE}${query}`);
  const first = await waitForPage(browser);
  if (first === undefined) {
    return { problem: 'the test page did not finish' };
  }

  const armed = await command(browser, { kind: 'arm' });
  if (!armed.ok) {
    return { problem: `arming failed: ${String(armed.error)}` };
  }

  const page = await waitForPage(browser, first.loadId);
  return page === undefined ? { problem: 'the armed page did not finish loading' } : { page };
}

/** An extension-page script that registers trial scripts shaped like the capture scripts and says what the browser answered. */
function registrationTrialScript(api: 'browser' | 'chrome'): string {
  return `(async () => {
    const shape = { matches: ['*://127.0.0.1/*'], runAt: 'document_start', persistAcrossSessions: true };
    try {
      await ${api}.scripting.registerContentScripts([
        { id: 'trial-main', js: ['content-scripts/player-capture-main.js'], world: 'MAIN', ...shape },
        { id: 'trial-page', js: ['content-scripts/player-capture-page.js'], ...shape },
      ]);
      await ${api}.scripting.unregisterContentScripts({ ids: ['trial-main', 'trial-page'] });
      return 'accepted';
    } catch (error) {
      return 'refused: ' + error;
    }
  })()`;
}

/** Both capture scripts are known to the browser once the setting is on. */
async function checkRegistered(browser: CaptureSmokeBrowser, problems: string[], label: string): Promise<boolean> {
  const wanted = ['streamdraft-player-capture', 'streamdraft-player-capture-page'];
  const script = `(async () => JSON.stringify((await ${browser.api}.scripting.getRegisteredContentScripts()).map((entry) => entry.id)))()`;
  let ids: string[] = [];
  // The background may have to wake up to act on the changed setting.
  const registered = await waitUntil(browser, async () => {
    const text = await browser.inExtension(script);
    ids = text === undefined ? [] : (JSON.parse(text) as string[]);
    return wanted.every((id) => ids.includes(id));
  });
  if (!registered) {
    const tried = await browser.inExtension(registrationTrialScript(browser.api));
    problems.push(`${label}: the capture scripts are not registered after switching the setting on (registered: [${ids.join(', ')}]); registering the same scripts from the options page says: ${String(tried)}`);
  }
  return registered;
}

async function checkHidingAndStatus(browser: CaptureSmokeBrowser, pageUrl: string, problems: string[], label: string): Promise<boolean> {
  await browser.openTestPage(`${pageUrl}${MSE_PAGE}`);
  const unarmed = await waitForPage(browser);
  if (unarmed?.isTypeSupported?.[VP9] !== true) {
    problems.push(`${label}: an ordinary load of the page should still be offered VP9, got ${JSON.stringify(unarmed?.isTypeSupported)}`);
    return false;
  }

  const reply = await command(browser, { kind: 'status' });
  const idle = reply.ok ? (reply.value as Snapshot) : undefined;
  if (idle === undefined || idle.buffers.length !== 0) {
    problems.push(`${label}: a page that was not armed should have recorded nothing, got ${JSON.stringify(reply)}`);
    return false;
  }
  return true;
}

async function checkRecording(browser: CaptureSmokeBrowser, pageUrl: string, downloadDir: string, problems: string[], label: string): Promise<void> {
  const loaded = await recordedLoad(browser, pageUrl, '');
  if (loaded.page === undefined) {
    problems.push(`${label}: ${String(loaded.problem)}`);
    return;
  }
  if (loaded.page.error !== null || loaded.page.picked?.includes('avc1') !== true) {
    problems.push(`${label}: the armed page should have been offered H.264 only, got ${JSON.stringify(loaded.page)}`);
    return;
  }

  let status: Snapshot | undefined;
  const complete = await waitUntil(browser, async () => {
    status = await statusOf(browser);
    return status?.complete === true;
  });
  const lengths = status?.buffers.map((buffer) => buffer.fragmentCount);
  if (!complete || Math.abs((status?.durationSeconds ?? 0) - LENGTH_SECONDS) > LENGTH_TOLERANCE_SECONDS || JSON.stringify(lengths) !== JSON.stringify([3, 3])) {
    problems.push(`${label}: the recording should be complete (12 s, 3 segments of picture and sound), got ${JSON.stringify(status)}`);
    return;
  }

  for (const [soundOnly, name, samples, kinds] of [
    [false, MSE_VIDEO_FILE, [PICTURE_SAMPLES, SOUND_SAMPLES], ['audio', 'video']],
    [true, MSE_SOUND_FILE, [SOUND_SAMPLES], ['audio']],
  ] as const) {
    const saved = await command(browser, { kind: 'save', soundOnly });
    if (!saved.ok) {
      problems.push(`${label}: saving ${name} failed: ${String(saved.error)}`);
      return;
    }

    const file = await savedFile(browser, downloadDir, name);
    if (file === undefined) {
      problems.push(`${label}: expected ${name} in the download folder, found [${readdirSync(downloadDir).join(', ')}]`);
      return;
    }
    const wrong = recordedFileProblem(file, [...samples], [...kinds]);
    if (wrong !== undefined) {
      problems.push(`${label}: ${wrong}`);
      return;
    }
  }
  console.log(`${label}: the player was offered H.264 only; the 12 s recording is complete and was saved with picture and sound (${PICTURE_SAMPLES} and ${SOUND_SAMPLES} samples) and as sound only`);
}

async function checkRefusals(browser: CaptureSmokeBrowser, pageUrl: string, problems: string[], label: string): Promise<void> {
  const cases = [
    ['?switch=1', 'changed the quality', 'a quality switch'],
    ['?eme=1', 'protected', 'encrypted media'],
  ] as const;

  for (const [query, message, what] of cases) {
    const loaded = await recordedLoad(browser, pageUrl, query);
    if (loaded.page === undefined || loaded.page.error !== null) {
      problems.push(`${label}: ${what}: ${String(loaded.problem ?? loaded.page?.error)}`);
      return;
    }

    let refusal: string | undefined;
    const refused = await waitUntil(browser, async () => {
      const saved = await command(browser, { kind: 'save', soundOnly: false });
      refusal = saved.ok ? undefined : saved.error;
      return refusal !== undefined && refusal.includes(message);
    });
    if (!refused) {
      problems.push(`${label}: ${what} should be refused with "${message}", got ${JSON.stringify(refusal)}`);
      return;
    }
  }
  console.log(`${label}: a quality switch in the middle and encrypted media are refused with a reason`);
}

/**
 * The whole check: switch the capture on for the test page's site, see that an ordinary load is untouched,
 * record and save, then the refusals, then switch it off again.
 */
export async function checkPlayerCapture(browser: CaptureSmokeBrowser, pageUrl: string, downloadDir: string, problems: string[], label: string): Promise<void> {
  // A freshly opened extension page may not be ready for its first script: asked again until it answers.
  const switchedOn = await waitUntil(browser, async () => (await browser.inExtension(captureSettingScript(browser.api, true, ['127.0.0.1']))) === 'done');
  if (!switchedOn) {
    problems.push(`${label}: the setting could not be switched on`);
    return;
  }
  await browser.sleep(SETTING_SETTLE_MS);

  try {
    if ((await checkRegistered(browser, problems, label)) && (await checkHidingAndStatus(browser, pageUrl, problems, label))) {
      await checkRecording(browser, pageUrl, downloadDir, problems, label);
      await checkRefusals(browser, pageUrl, problems, label);
    }
  } finally {
    await command(browser, { kind: 'discard' });
    await browser.inExtension(captureSettingScript(browser.api, false, ['127.0.0.1']));
  }
}
