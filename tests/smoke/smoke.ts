import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import * as firefox from 'selenium-webdriver/firefox.js';
import { startTestPageServer } from '../pages/server.ts';
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
import { checkLargeDownload, LARGE_FILE_NAME, LARGE_PAGE, largeCheckEnabled } from './large-stream.ts';
import { isSilentStreamFile, SILENT_PAGE, silentStreamProblem } from './silent-stream.ts';
import {
  captureSettingScript,
  clearPageDataScript,
  hasPageData,
  MAIN_WORLD_PAGE,
  NOTHING_HAPPENS_MS,
  pageDataProblem,
  pageDataScript,
  SETTING_SETTLE_MS,
} from './page-data.ts';
import { checkPlayerCapture, type CaptureSmokeBrowser } from './player-capture.ts';
import { PARTS_CARD_COUNT, PARTS_PAGE, partsProblem, registryScript } from './stream-parts.ts';

// Smoke test of the PACKAGES (not the build output folder):
//   1. extract each zip into an empty folder and check its manifest;
//   2. load the Firefox package in a real (headless) Firefox, open the popup and
//      check that the background script answers.
// Chrome is checked statically only; running it is added in a later milestone.
// Set SMOKE_SKIP_BROWSER=1 to skip step 2 (for machines without Firefox).
// Set FIREFOX_BIN to use a specific Firefox binary.

/** What the popup, the overlay and the menu say once the browser has started a download. */
const SAVING = 'Saving as "StreamDraft test page [original]';

const ADDON_ID = 'streamdraft@shaulk80.github.io';
const FIXED_UUID = 'f3c2a9e0-6b1d-4d2a-9a55-3b7c1e0d4a10';
const WAIT_MS = 20_000;

const problems: string[] = [];

interface Manifest {
  manifest_version?: number;
  name?: string;
  version?: string;
  action?: { default_popup?: string };
  background?: unknown;
  browser_specific_settings?: { gecko?: { id?: string } };
}

function checkManifest(label: string, dir: string, version: string, expectGeckoId: boolean): void {
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch (error) {
    console.error(error);
    problems.push(`${label}: manifest.json is missing or not valid JSON`);
    return;
  }

  const expectations: [string, boolean][] = [
    ['manifest_version is 3', manifest.manifest_version === 3],
    ['name is StreamDraft', manifest.name === 'StreamDraft'],
    [`version is ${version}`, manifest.version === version],
    ['has a popup', typeof manifest.action?.default_popup === 'string'],
    ['has a background entry', manifest.background !== undefined],
  ];
  if (expectGeckoId) {
    expectations.push([`gecko id is ${ADDON_ID}`, manifest.browser_specific_settings?.gecko?.id === ADDON_ID]);
  }

  for (const [description, passed] of expectations) {
    if (!passed) {
      problems.push(`${label}: expected ${description}`);
    }
  }
}

// WebDriver refuses to navigate to moz-extension:// URLs ("not allowed in this
// context"), so open the tab from browser (chrome) context with the system
// principal, then switch back to content and to the new tab.
async function openInNewTab(driver: firefox.Driver, url: string): Promise<void> {
  const handlesBefore = await driver.getAllWindowHandles();

  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(
      `const tab = window.gBrowser.addTab(arguments[0], {
         triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
       });
       window.gBrowser.selectedTab = tab;`,
      url,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }

  const handles = await driver.getAllWindowHandles();
  const newHandle = handles.find((handle) => !handlesBefore.includes(handle));
  if (newHandle === undefined) {
    problems.push('firefox runtime: the popup tab did not open');
    return;
  }
  await driver.switchTo().window(newHandle);
}

// The popup tab is open: it must list the four mock videos, flag the protected
// one, preselect the default quality and answer a click on Download.
async function checkPopupList(driver: firefox.Driver): Promise<void> {
  await driver.wait(async () => (await driver.findElements(By.css('#media-list .card'))).length === 4, WAIT_MS);

  const notices = await driver.findElements(By.css('#media-list .notice'));
  if (notices.length !== 1) {
    problems.push(`firefox runtime: popup: expected 1 DRM notice, found ${notices.length}`);
  }

  const buttons = await driver.findElements(By.css('#media-list .download'));
  if (buttons.length !== 3) {
    problems.push(`firefox runtime: popup: expected 3 download buttons, found ${buttons.length}`);
    return;
  }

  // The second video is the HLS one; the default quality "best" preselects its first option.
  const picker = (await driver.findElements(By.css('#media-list .quality')))[1];
  const selected = await picker?.getAttribute('value');
  if (selected !== '1080p') {
    problems.push(`firefox runtime: popup: expected 1080p preselected, got "${String(selected)}"`);
  }

  await buttons[1]?.click();
  const result = (await driver.findElements(By.css('#media-list .result')))[1];
  if (!result) {
    problems.push('firefox runtime: popup: no result line after Download');
    return;
  }
  await driver.wait(until.elementTextContains(result, 'Demo only'), WAIT_MS);
  console.log(`Firefox runtime: popup lists 4 videos; Download says "${await result.getText()}"`);
}

// Opens the local test page and checks the overlay on it, then switches the
// setting off and on again from an options tab to see that it applies live.
async function checkOverlay(driver: firefox.Driver, pageUrl: string): Promise<void> {
  const hostSelector = By.css('#streamdraft-overlay');

  await openInNewTab(driver, pageUrl);
  const pageHandle = await driver.getWindowHandle();

  // Four videos on the page (one is added after 1.5 s), one overlay each.
  await driver.wait(async () => (await driver.findElements(hostSelector)).length === 4, WAIT_MS);
  const hosts = await driver.findElements(hostSelector);
  const normalShown = await hosts[0]?.isDisplayed();
  const smallShown = await hosts[1]?.isDisplayed();
  if (normalShown !== true || smallShown !== false) {
    problems.push(`firefox runtime: overlay: normal video shown=${String(normalShown)}, small video shown=${String(smallShown)}`);
    return;
  }

  const shadow = await hosts[0]?.getShadowRoot();
  if (!shadow) {
    problems.push('firefox runtime: overlay: the first overlay has no shadow root');
    return;
  }
  await (await shadow.findElement(By.css('.toggle'))).click();
  await (await shadow.findElement(By.css('.download'))).click();
  const result = await shadow.findElement(By.css('.result'));
  await driver.wait(until.elementTextContains(result, SAVING), WAIT_MS);
  console.log(`Firefox runtime: overlay panel says "${await result.getText()}"`);

  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/options.html`);
  const optionsHandle = await driver.getWindowHandle();
  const toggle = await driver.wait(until.elementLocated(By.id('in-page-button')), WAIT_MS);
  const status = driver.findElement(By.id('form-status'));
  await driver.wait(async () => toggle.isSelected(), WAIT_MS);

  await toggle.click();
  await driver.wait(until.elementTextContains(status, 'Saved'), WAIT_MS);
  await driver.switchTo().window(pageHandle);
  await driver.wait(async () => (await driver.findElements(hostSelector)).length === 0, WAIT_MS);
  console.log('Firefox runtime: overlays disappear when the setting is switched off');

  await driver.switchTo().window(optionsHandle);
  await toggle.click();
  await driver.wait(async () => (await toggle.isSelected()) === true, WAIT_MS);
  await driver.switchTo().window(pageHandle);
  await driver.wait(async () => (await driver.findElements(hostSelector)).length === 4, WAIT_MS);
  console.log('Firefox runtime: overlays come back when the setting is switched on');
}

// Opens the detection test page and then the popup for that tab (the popup is
// opened as a tab of its own, so it is told which tab to look at). The page has
// four files in its markup (one added by script) and two that only a script
// fetches: one real video and one too small to be a video.
const DETECTION_PAGE = 'detect.html';
const PAGE_TITLE = 'StreamDraft detection test page';
const EXPECTED_FILES = ['clip.webm', 'direct.mp4', 'hidden-stream', 'late.mp4', 'song.mp3'];

// Read in one script call: the popup redraws its list while videos are still being found,
// and elements fetched one by one would go stale in between.
async function metaTexts(driver: firefox.Driver): Promise<string[]> {
  return driver.executeScript<string[]>(
    "return [...document.querySelectorAll('#media-list .meta')].map((meta) => meta.textContent);",
  );
}

async function cardTitles(driver: firefox.Driver): Promise<string[]> {
  return driver.executeScript<string[]>(
    "return [...document.querySelectorAll('#media-list .title')].map((title) => title.textContent);",
  );
}

async function listedFileNames(driver: firefox.Driver): Promise<string[]> {
  // The line reads "site · kind · file name".
  return (await metaTexts(driver)).map((text) => text.split(' · ').pop() ?? '').sort();
}

async function checkDetection(driver: firefox.Driver, pageUrl: string, downloadDir: string): Promise<void> {
  await openInNewTab(driver, `${pageUrl}${DETECTION_PAGE}`);
  const status = await driver.wait(until.elementLocated(By.id('fetch-status')), WAIT_MS);
  await driver.wait(until.elementTextContains(status, 'fetched'), WAIT_MS);

  // Match patterns ignore the port.
  const pattern = `http://127.0.0.1/${DETECTION_PAGE}*`;
  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/popup.html?tabUrl=${encodeURIComponent(pattern)}`);

  const expected = EXPECTED_FILES.join(', ');
  try {
    await driver.wait(async () => (await listedFileNames(driver)).join(', ') === expected, WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push(`firefox runtime: detection: expected [${expected}], popup lists [${(await listedFileNames(driver)).join(', ')}]`);
    return;
  }
  // A file the network observer finds while the page loads is first named after the address
  // (the tab has no title yet); the title must catch up.
  try {
    await driver.wait(async () => (await cardTitles(driver)).every((title) => title === PAGE_TITLE), WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push(`firefox runtime: detection: card titles should all be "${PAGE_TITLE}", they are [${(await cardTitles(driver)).join(' | ')}]`);
    return;
  }
  console.log(`Firefox runtime: detection lists ${EXPECTED_FILES.length} files for the test page (page scan and network observer), not the tiny one, all named after the page`);

  await checkRefresh(driver);
  await checkDownload(driver, downloadDir);
}

// HLS and DASH: the page loads a master playlist, one of its rendition playlists (which must
// not be listed) and a DASH manifest. The popup reads the manifests when it opens and offers
// their qualities.
const STREAMS_PAGE = 'streams.html';
const EXPECTED_STREAM_CARDS = [
  { meta: '127.0.0.1 · DASH stream · mp4', options: ['720p (8.9 MB)', '360p (2.9 MB)', 'Audio only (234 KB)'] },
  { meta: '127.0.0.1 · HLS stream · mp4', options: ['720p', '360p', 'Audio only'] },
];

interface StreamCard {
  meta: string;
  options: string[];
}

async function streamCards(driver: firefox.Driver): Promise<string> {
  const cards = await driver.executeScript<StreamCard[]>(
    "return [...document.querySelectorAll('#media-list .card')].map((card) => ({ meta: card.querySelector('.meta')?.textContent ?? '', options: [...card.querySelectorAll('.quality option')].map((option) => option.textContent) }));",
  );
  return JSON.stringify([...cards].sort((left, right) => left.meta.localeCompare(right.meta)));
}

async function checkStreams(driver: firefox.Driver, pageUrl: string): Promise<void> {
  await openInNewTab(driver, `${pageUrl}${STREAMS_PAGE}`);
  const status = await driver.wait(until.elementLocated(By.id('fetch-status')), WAIT_MS);
  await driver.wait(until.elementTextContains(status, 'fetched'), WAIT_MS);

  const pattern = `http://127.0.0.1/${STREAMS_PAGE}*`;
  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/popup.html?tabUrl=${encodeURIComponent(pattern)}`);

  const expected = JSON.stringify(EXPECTED_STREAM_CARDS);
  try {
    await driver.wait(async () => (await streamCards(driver)) === expected, WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push(`firefox runtime: streams: expected ${expected}, popup shows ${await streamCards(driver)}`);
    return;
  }
  console.log('Firefox runtime: streams: the HLS master and the DASH manifest are read when the popup opens and list their qualities; the rendition playlist is not listed');
}

// The segments of a stream that are separate .mp4 files must not be listed, a protected stream must be
// marked, and both must hold before any popup is opened (the manifests are read when they are found).
async function checkStreamParts(driver: firefox.Driver, pageUrl: string): Promise<void> {
  await openInNewTab(driver, `${pageUrl}${PARTS_PAGE}`);
  const status = await driver.wait(until.elementLocated(By.id('fetch-status')), WAIT_MS);
  await driver.wait(until.elementTextContains(status, 'fetched'), WAIT_MS);

  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/options.html`);
  const storedProblem = async (): Promise<string | undefined> =>
    partsProblem(await driver.executeAsyncScript<string>(`const done = arguments[arguments.length - 1]; (${registryScript('browser')}).then(done);`));
  try {
    await driver.wait(async () => (await storedProblem()) === undefined, WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push(`firefox runtime: stream parts: ${String(await storedProblem())}`);
    return;
  }

  const pattern = `http://127.0.0.1/${PARTS_PAGE}*`;
  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/popup.html?tabUrl=${encodeURIComponent(pattern)}`);
  try {
    await driver.wait(async () => (await driver.findElements(By.css('#media-list .card'))).length === PARTS_CARD_COUNT, WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push(`firefox runtime: stream parts: expected ${PARTS_CARD_COUNT} cards, popup shows ${JSON.stringify(await metaTexts(driver))}`);
    return;
  }
  const notices = await driver.executeScript<string[]>("return [...document.querySelectorAll('#media-list .notice')].map((notice) => notice.textContent);");
  if (notices.length !== 1 || !notices[0]?.includes('Widevine DRM')) {
    problems.push(`firefox runtime: stream parts: expected one Widevine notice, got ${JSON.stringify(notices)}`);
    return;
  }
  console.log('Firefox runtime: stream parts: the .mp4 segments of two streams are not listed; the protected stream says so; the manifests were read before the popup opened');
}

// The player capture is a switch: off, no page gets the MAIN-world script; on for a site, that site's page
// hands a variable of its own scripts to the background; off again, nothing more arrives.
async function checkPageData(driver: firefox.Driver, pageUrl: string): Promise<void> {
  const options = `moz-extension://${FIXED_UUID}/options.html`;
  const run = (script: string): Promise<string> =>
    driver.executeAsyncScript<string>(`const done = arguments[arguments.length - 1]; (${script}).then(done);`);
  const stored = async (): Promise<string> => run(pageDataScript('browser'));

  await openInNewTab(driver, `${pageUrl}${MAIN_WORLD_PAGE}`);
  await driver.sleep(NOTHING_HAPPENS_MS);
  await openInNewTab(driver, options);
  if (hasPageData(await stored())) {
    problems.push('firefox runtime: page data: the page was read although the player capture is off (the default)');
    return;
  }

  await run(captureSettingScript('browser', true, ['127.0.0.1']));
  await driver.sleep(SETTING_SETTLE_MS);
  await openInNewTab(driver, `${pageUrl}${MAIN_WORLD_PAGE}`);
  await openInNewTab(driver, options);
  try {
    await driver.wait(async () => pageDataProblem(await stored()) === undefined, WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push(`firefox runtime: page data: ${String(pageDataProblem(await stored()))}`);
    return;
  }

  await run(captureSettingScript('browser', false, ['127.0.0.1']));
  await run(clearPageDataScript('browser'));
  await driver.sleep(SETTING_SETTLE_MS);
  await openInNewTab(driver, `${pageUrl}${MAIN_WORLD_PAGE}`);
  await driver.sleep(NOTHING_HAPPENS_MS);
  await openInNewTab(driver, options);
  if (hasPageData(await stored())) {
    problems.push('firefox runtime: page data: the page was read after the player capture was switched off again');
    return;
  }
  console.log("Firefox runtime: page data: off by default; switched on for the site, the MAIN-world script read the page's own variable and the background holds it; switched off again, nothing arrives");
}

// The player capture end to end (tests/smoke/player-capture.ts): the test page's player is recorded in the
// page and joined into the same kind of file as a stream. Pages are told apart by their window handle.
async function checkPlayerCaptureRun(driver: firefox.Driver, pageUrl: string, downloadDir: string): Promise<void> {
  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/options.html`);
  const extensionHandle = await driver.getWindowHandle();
  let testHandle = extensionHandle;

  const browser: CaptureSmokeBrowser = {
    api: 'browser',
    openTestPage: async (url) => {
      await openInNewTab(driver, url);
      testHandle = await driver.getWindowHandle();
    },
    inTestPage: async (expression) => {
      try {
        await driver.switchTo().window(testHandle);
        return await driver.executeScript<unknown>(`return ${expression};`);
      } catch {
        // The page is loading: the caller asks again.
        return undefined;
      }
    },
    inExtension: async (script) => {
      await driver.switchTo().window(extensionHandle);
      return driver.executeAsyncScript<string>(`const done = arguments[arguments.length - 1]; (${script}).then(done);`);
    },
    sleep: (milliseconds) => driver.sleep(milliseconds),
  };
  await checkPlayerCapture(browser, pageUrl, downloadDir, problems, 'Firefox runtime: player capture');
}

/** The open popup, for reading the text of its cards (nothing to press, nothing to reload). */
function popupPage(driver: firefox.Driver): PopupPage {
  return {
    act: async () => undefined,
    read: (expression) => driver.executeScript<string | undefined>('return ' + expression + ';'),
    reload: async () => undefined,
  };
}

// The page has two small streams with real segments (tests/pages/generated-stream.ts). Download on
// each card must fetch the parts, join them into one MP4 and save it: in the background page, with the
// file handed to the browser as a Blob address.
async function checkStreamDownloads(driver: firefox.Driver, pageUrl: string, downloadDir: string): Promise<void> {
  await openInNewTab(driver, `${pageUrl}${STREAM_PAGE}`);
  const status = await driver.wait(until.elementLocated(By.id('fetch-status')), WAIT_MS);
  await driver.wait(until.elementTextContains(status, 'fetched'), WAIT_MS);

  const pattern = `http://127.0.0.1/${STREAM_PAGE}*`;
  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/popup.html?tabUrl=${encodeURIComponent(pattern)}`);
  try {
    await driver.wait(async () => (await driver.findElements(By.css('#media-list .download'))).length === 2, WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push('firefox runtime: stream download: the popup did not list two streams with qualities');
    return;
  }

  await driver.executeScript("for (const button of document.querySelectorAll('#media-list .download')) { button.click(); }");
  const expected = [DASH_FILE_NAME, HLS_FILE_NAME];
  try {
    await driver.wait(() => expected.every((name) => existsSync(path.join(downloadDir, name))), WAIT_MS);
  } catch (error) {
    console.error(error);
    const said = await driver.executeScript<string[]>("return [...document.querySelectorAll('#media-list .result')].map((result) => result.textContent);");
    problems.push(`firefox runtime: stream download: expected [${expected.join(', ')}] in the download folder, found [${readdirSync(downloadDir).join(', ')}]; the popup said [${said.join(' | ')}]`);
    return;
  }

  // The name is in the folder while Firefox is still writing the file (the movie box comes last): the
  // files are read once the cards say they are saved.
  const unsaved = await savedTextProblem(popupPage(driver), expected.length);
  if (unsaved !== undefined) {
    problems.push('firefox runtime: stream download: ' + unsaved);
  }

  const found = [dashFileProblem(path.join(downloadDir, DASH_FILE_NAME)), hlsFileProblem(path.join(downloadDir, HLS_FILE_NAME))].filter((problem) => problem !== undefined);
  found.forEach((problem) => problems.push(`firefox runtime: stream download: ${problem}`));
  if (found.length === 0) {
    console.log('Firefox runtime: stream download: the DASH stream (picture and sound) and the HLS stream were fetched, joined and saved as readable MP4 files');
  }

  await checkSoundDownloads(driver, downloadDir);
}

// The popup's job display: progress of a slow stream (also in a popup opened again), Cancel, and the
// words for a stream whose part is missing (tests/pages/jobs.html).
async function checkJobs(driver: firefox.Driver, pageUrl: string): Promise<void> {
  await openInNewTab(driver, `${pageUrl}${JOBS_PAGE}`);
  const status = await driver.wait(until.elementLocated(By.id('fetch-status')), WAIT_MS);
  await driver.wait(until.elementTextContains(status, 'fetched'), WAIT_MS);

  const pattern = encodeURIComponent(`http://127.0.0.1/${JOBS_PAGE}*`);
  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/popup.html?tabUrl=${pattern}`);
  const twoStreams = async (): Promise<void> => {
    await driver.wait(async () => (await driver.findElements(By.css('#media-list .download'))).length === 2, WAIT_MS);
  };
  try {
    await twoStreams();
  } catch (error) {
    console.error(error);
    problems.push('firefox runtime: job display: the popup did not list two streams with qualities');
    return;
  }

  const popup: PopupPage = {
    act: async (statements) => {
      await driver.executeScript(statements);
    },
    read: (expression) => driver.executeScript<string | undefined>(`return ${expression};`),
    reload: async () => {
      await driver.navigate().refresh();
      await twoStreams();
    },
  };
  const found = await checkJobDisplay(popup);
  found.forEach((problem) => problems.push(`firefox runtime: job display: ${problem}`));
  if (found.length === 0) {
    console.log('Firefox runtime: job display: a slow stream showed its progress (also in a popup opened again) and was cancelled, a stream with a missing part ended with the failure text');
  }
}

// Opt-in (SMOKE_LARGE=1): a stream of 1.1 GiB is downloaded while the memory of Firefox is sampled.
async function checkLargeStream(driver: firefox.Driver, pageUrl: string, downloadDir: string): Promise<void> {
  await openInNewTab(driver, `${pageUrl}${LARGE_PAGE}`);
  const status = await driver.wait(until.elementLocated(By.id('fetch-status')), WAIT_MS);
  await driver.wait(until.elementTextContains(status, 'fetched'), WAIT_MS);

  const pattern = encodeURIComponent(`http://127.0.0.1/${LARGE_PAGE}*`);
  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/popup.html?tabUrl=${pattern}`);
  try {
    await driver.wait(async () => (await driver.findElements(By.css('#media-list .download'))).length === 1, WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push('firefox runtime: large stream: the popup did not list the stream with qualities');
    return;
  }

  const popup: PopupPage = {
    act: async (statements) => {
      await driver.executeScript(statements);
    },
    read: (expression) => driver.executeScript<string | undefined>(`return ${expression};`),
    reload: async () => undefined,
  };
  const storageUsage = (): Promise<number | undefined> =>
    driver.executeAsyncScript<number | undefined>('const done = arguments[arguments.length - 1]; navigator.storage.estimate().then((estimate) => done(estimate.usage), () => done(undefined));');
  const found = await checkLargeDownload('Firefox', popup, path.join(downloadDir, LARGE_FILE_NAME), storageUsage);
  found.forEach((problem) => problems.push(`firefox runtime: large stream: ${problem}`));
}

// "Audio only" on both cards: the DASH stream has a sound representation of its own, the HLS
// stream carries its sound inside the video segments and the engine takes it out.
async function checkSoundDownloads(driver: firefox.Driver, downloadDir: string): Promise<void> {
  for (let card = 0; card < AUDIO_FILE_COUNT; card++) {
    await driver.executeScript(saveSoundScript(card));
    try {
      await driver.wait(() => audioFileNames(readdirSync(downloadDir)).length === card + 1, WAIT_MS);
    } catch (error) {
      console.error(error);
      const said = await driver.executeScript<string[]>("return [...document.querySelectorAll('#media-list .result')].map((result) => result.textContent);");
      problems.push(`firefox runtime: audio only: card ${card + 1} of ${AUDIO_FILE_COUNT}: no .m4a file arrived in the download folder, found [${readdirSync(downloadDir).join(', ')}]; the popup said [${said.join(' | ')}]`);
      return;
    }
  }

  // Both cards must have finished before the files are read: the name shows up while the file is written.
  const unsaved = await savedTextProblem(popupPage(driver), AUDIO_FILE_COUNT);
  if (unsaved !== undefined) {
    problems.push('firefox runtime: audio only: ' + unsaved);
    return;
  }

  const problem = audioFilesProblem(downloadDir, audioFileNames(readdirSync(downloadDir)));
  if (problem === undefined) {
    console.log('Firefox runtime: audio only: the DASH sound and the sound cut out of the HLS video were saved as .m4a files with one sound track each');
    return;
  }
  problems.push(`firefox runtime: audio only: ${problem}`);
}

// A stream with a picture and no sound track: "Audio only" must end with the words for it, and nothing
// is saved.
async function checkSilentStream(driver: firefox.Driver, pageUrl: string, downloadDir: string): Promise<void> {
  await openInNewTab(driver, `${pageUrl}${SILENT_PAGE}`);
  const status = await driver.wait(until.elementLocated(By.id('fetch-status')), WAIT_MS);
  await driver.wait(until.elementTextContains(status, 'fetched'), WAIT_MS);

  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/popup.html?tabUrl=${encodeURIComponent(`http://127.0.0.1/${SILENT_PAGE}*`)}`);
  try {
    await driver.wait(async () => (await driver.findElements(By.css('#media-list .download'))).length === 1, WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push('firefox runtime: silent stream: the popup did not list the stream with qualities');
    return;
  }

  const popup: PopupPage = {
    act: async (statements) => {
      await driver.executeScript(statements);
    },
    read: (expression) => driver.executeScript<string | undefined>(`return ${expression};`),
    reload: async () => undefined,
  };
  const problem = await silentStreamProblem(popup);
  const saved = readdirSync(downloadDir).filter(isSilentStreamFile);
  if (problem !== undefined || saved.length > 0) {
    problems.push(`firefox runtime: silent stream: ${problem ?? ''} saved files: [${saved.join(', ')}]`);
    return;
  }
  console.log('Firefox runtime: silent stream: "Audio only" on a video without a sound track ended with "This video has no sound to save." and saved nothing');
}

// The Refresh button must reach the page's content script and get its answer: the note
// says so and the list stays complete. (Emptying the saved list first, to see the page's files
// come back, is done in the Chrome test: Firefox's test scripts cannot reach the extension API.)
async function checkRefresh(driver: firefox.Driver): Promise<void> {
  await driver.findElement(By.id('refresh')).click();
  const note = driver.findElement(By.id('refresh-note'));
  try {
    await driver.wait(until.elementTextContains(note, 'Checked the page again.'), WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push(`firefox runtime: refresh: the note said "${await note.getText()}"`);
    return;
  }

  const text = await note.getText();
  const listed = (await listedFileNames(driver)).join(', ');
  if (!text.includes(`${EXPECTED_FILES.length} videos listed.`) || listed !== EXPECTED_FILES.join(', ')) {
    problems.push(`firefox runtime: refresh: note "${text}", popup lists [${listed}]`);
    return;
  }
  console.log(`Firefox runtime: Refresh reached the page and kept the list complete ("${text}")`);
}

// The test server's direct.mp4 is 300 KB of filler. Clicking Download must save it
// under the template name (page title, "original" for a plain file) in the download folder.
const DOWNLOADED_NAME = 'StreamDraft detection test page [original].mp4';
const DOWNLOADED_SIZE = 300 * 1024;

async function checkDownload(driver: firefox.Driver, downloadDir: string): Promise<void> {
  const names = await listedFileNames(driver);
  const index = names.indexOf('direct.mp4');
  const cardIndex = (await metaTexts(driver)).findIndex((text) => text.endsWith('direct.mp4'));
  const button = (await driver.findElements(By.css('#media-list .download')))[cardIndex];
  if (index < 0 || !button) {
    problems.push('firefox runtime: download: the card of direct.mp4 has no Download button');
    return;
  }

  await button.click();
  const result = (await driver.findElements(By.css('#media-list .result')))[cardIndex];
  if (!result) {
    problems.push('firefox runtime: download: no result line after Download');
    return;
  }
  await driver.wait(async () => (await result.getText()) !== '', WAIT_MS);
  const text = await result.getText();
  if (!text.includes(DOWNLOADED_NAME)) {
    problems.push(`firefox runtime: download: the popup said "${text}"`);
    return;
  }

  const target = path.join(downloadDir, DOWNLOADED_NAME);
  try {
    await driver.wait(() => readdirSync(downloadDir).includes(DOWNLOADED_NAME) && statSync(target).size === DOWNLOADED_SIZE, WAIT_MS);
  } catch (error) {
    console.error(error);
    problems.push(`firefox runtime: download: expected ${DOWNLOADED_NAME} (${DOWNLOADED_SIZE} bytes) in the download folder, found [${readdirSync(downloadDir).join(', ')}]`);
    return;
  }
  console.log(`Firefox runtime: Download saved "${DOWNLOADED_NAME}" (${DOWNLOADED_SIZE} bytes) in the download folder`);
}

// The overlay button and the menu entry both saved the page's first video (300 KB of
// filler); the second one got a different name (the browser never overwrites a file).
function checkTestPageDownloads(downloadDir: string): void {
  const saved = readdirSync(downloadDir).filter((name) => name.startsWith('StreamDraft test page [original]'));
  const sizes = saved.map((name) => statSync(path.join(downloadDir, name)).size);
  if (saved.length !== 2 || sizes.some((size) => size !== DOWNLOADED_SIZE)) {
    problems.push(`firefox runtime: download: expected two 300 KB files from the test page, found [${saved.join(', ')}] with sizes [${sizes.join(', ')}]`);
    return;
  }
  console.log(`Firefox runtime: the overlay button and the menu entry each saved the video (${saved.join(', ')})`);
}

const MENU_LABEL = 'Download video with StreamDraft';

async function inChromeContext<T>(driver: firefox.Driver, script: string, ...args: unknown[]): Promise<T> {
  await driver.setContext(firefox.Context.CHROME);
  try {
    return (await driver.executeScript(script, ...args)) as T;
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

const FIND_ENTRY = `
  const popup = document.getElementById('contentAreaContextMenu');
  const item = popup && Array.from(popup.querySelectorAll('menuitem, menu'))
    .find((element) => element.getAttribute('label') === arguments[0] && !element.hidden);
  return item !== undefined && item !== null;`;

const CHOOSE_ENTRY = `
  const popup = document.getElementById('contentAreaContextMenu');
  const item = Array.from(popup.querySelectorAll('menuitem, menu'))
    .find((element) => element.getAttribute('label') === arguments[0]);
  popup.activateItem(item);`;

const CLOSE_MENU = `
  const popup = document.getElementById('contentAreaContextMenu');
  if (popup) { popup.hidePopup(); }`;

async function openContextMenu(driver: firefox.Driver): Promise<void> {
  await driver.actions().contextClick(driver.findElement(By.id('normal'))).perform();
}

// Right-clicks the video and says whether Firefox's menu has our entry; with
// `choose` it also chooses the entry, otherwise the menu is closed again.
async function rightClickVideo(driver: firefox.Driver, choose: boolean): Promise<boolean> {
  // The menu takes a moment to open. Wait longer when the entry is expected.
  const deadline = Date.now() + (choose ? WAIT_MS : 3000);
  let found = false;

  await openContextMenu(driver);
  while (!found && Date.now() < deadline) {
    await driver.sleep(300);
    found = await inChromeContext<boolean>(driver, FIND_ENTRY, MENU_LABEL);
  }

  if (found && choose) {
    await inChromeContext<void>(driver, CHOOSE_ENTRY, MENU_LABEL);
    return true;
  }
  await inChromeContext<void>(driver, CLOSE_MENU);
  return found;
}

// The right-click entry exists, downloads the video and answers a click with a toast, and follows
// the setting (switched off and on again from an options tab, without reloading).
async function checkContextMenu(driver: firefox.Driver, pageUrl: string): Promise<void> {
  await openInNewTab(driver, pageUrl);
  const pageHandle = await driver.getWindowHandle();
  await driver.wait(until.elementLocated(By.id('streamdraft-overlay')), WAIT_MS);

  if (!(await rightClickVideo(driver, true))) {
    problems.push('firefox runtime: context menu: the entry is missing');
    return;
  }
  const toast = await driver.wait(until.elementLocated(By.id('streamdraft-toast')), WAIT_MS);
  const toastText = await (await (await toast.getShadowRoot()).findElement(By.css('.toast'))).getText();
  if (!toastText.includes(SAVING)) {
    problems.push(`firefox runtime: context menu: unexpected toast "${toastText}"`);
  }
  console.log(`Firefox runtime: context menu entry answers "${toastText}"`);

  await openInNewTab(driver, `moz-extension://${FIXED_UUID}/options.html`);
  const optionsHandle = await driver.getWindowHandle();
  const toggle = await driver.wait(until.elementLocated(By.id('context-menu')), WAIT_MS);
  await driver.wait(async () => toggle.isSelected(), WAIT_MS);

  await toggle.click();
  await driver.wait(until.elementTextContains(driver.findElement(By.id('form-status')), 'Saved'), WAIT_MS);
  await driver.switchTo().window(pageHandle);
  if (await rightClickVideo(driver, false)) {
    problems.push('firefox runtime: context menu: the entry is still there after switching it off');
  }

  await driver.switchTo().window(optionsHandle);
  await toggle.click();
  await driver.wait(async () => (await toggle.isSelected()) === true, WAIT_MS);
  await driver.switchTo().window(pageHandle);
  if (!(await rightClickVideo(driver, false))) {
    problems.push('firefox runtime: context menu: the entry did not come back after switching it on');
  }
  console.log('Firefox runtime: context menu entry follows the setting');
}

// Changes a setting on the options page, then opens the page again in a new
// tab to see that the change was stored, and types a bad template to see the error.
async function checkOptionsPage(driver: firefox.Driver): Promise<void> {
  const optionsUrl = `moz-extension://${FIXED_UUID}/options.html`;

  await openInNewTab(driver, optionsUrl);
  const toggle = await driver.wait(until.elementLocated(By.id('in-page-button')), WAIT_MS);
  // The form is filled once the settings are loaded, so wait for the default.
  await driver.wait(async () => toggle.isSelected(), WAIT_MS, 'the in-page button should be on by default');
  await toggle.click();
  await driver.wait(until.elementTextContains(driver.findElement(By.id('form-status')), 'Saved'), WAIT_MS);

  await openInNewTab(driver, optionsUrl);
  const reopened = await driver.wait(until.elementLocated(By.id('in-page-button')), WAIT_MS);
  await driver.wait(async () => !(await reopened.isSelected()), WAIT_MS);
  console.log('Firefox runtime: options page keeps a changed setting');

  const template = driver.findElement(By.id('filename-template'));
  await template.clear();
  await template.sendKeys('{nope}');
  await driver.wait(until.elementTextContains(driver.findElement(By.id('form-status')), 'Unknown placeholder'), WAIT_MS);
  console.log('Firefox runtime: options page rejects a bad file name template');
}

async function checkFirefoxRuntime(zipPath: string): Promise<void> {
  const options = new firefox.Options();
  options.addArguments('-headless');
  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: FIXED_UUID }));
  // Downloads go to a folder of the test, without a dialog.
  const downloadDir = mkdtempSync(path.join(tmpdir(), 'streamdraft-downloads-'));
  options.setPreference('browser.download.folderList', 2);
  options.setPreference('browser.download.dir', downloadDir);
  options.setPreference('browser.download.useDownloadDir', true);
  const binary = process.env['FIREFOX_BIN'];
  if (binary) {
    options.setBinary(binary);
  }

  // System access is needed to open the extension page from browser context;
  // geckodriver takes it as its own flag, not as a browser argument.
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');

  // With forBrowser('firefox') the builder returns a Firefox driver.
  const driver = (await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build()) as firefox.Driver;
  try {
    await driver.installAddon(zipPath, true);
    await openInNewTab(driver, `moz-extension://${FIXED_UUID}/popup.html?mock=1`);

    const heading = await driver.wait(until.elementLocated(By.css('h1')), WAIT_MS);
    const headingText = await heading.getText();
    if (headingText !== 'StreamDraft') {
      problems.push(`firefox runtime: popup heading was "${headingText}"`);
    }

    const status = driver.findElement(By.id('status'));
    await driver.wait(until.elementTextContains(status, 'ready'), WAIT_MS);
    console.log(`Firefox runtime: popup shows "${await status.getText()}"`);

    await checkPopupList(driver);
    const testPage = await startTestPageServer(0);
    try {
      await checkOverlay(driver, testPage.url);
      await checkContextMenu(driver, testPage.url);
      await checkDetection(driver, testPage.url, downloadDir);
      await checkStreams(driver, testPage.url);
      await checkStreamParts(driver, testPage.url);
      await checkPageData(driver, testPage.url);
      await checkPlayerCaptureRun(driver, testPage.url, downloadDir);
      await checkStreamDownloads(driver, testPage.url, downloadDir);
      await checkSilentStream(driver, testPage.url, downloadDir);
      await checkJobs(driver, testPage.url);
      if (largeCheckEnabled()) {
        await checkLargeStream(driver, testPage.url, downloadDir);
      }
    } finally {
      await testPage.close();
    }
    await checkOptionsPage(driver);
    checkTestPageDownloads(downloadDir);
  } catch (error) {
    console.error(error);
    problems.push('firefox runtime: a page check failed (see the error above)');
  } finally {
    await driver.quit();
    rmSync(downloadDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function main(): Promise<void> {
  const version = readVersion();
  const firefoxZip = path.join(packageDir, `streamdraft-${version}-firefox.zip`);
  const chromeZip = path.join(packageDir, `streamdraft-${version}-chrome.zip`);
  const workDir = mkdtempSync(path.join(tmpdir(), 'streamdraft-smoke-'));

  try {
    for (const [label, zipPath, expectGeckoId] of [
      ['firefox package', firefoxZip, true],
      ['chrome package', chromeZip, false],
    ] as const) {
      const target = path.join(workDir, label.split(' ')[0] ?? 'package');
      try {
        extract(zipPath, target);
      } catch (error) {
        console.error(error);
        problems.push(`${label}: cannot extract ${zipPath}`);
        continue;
      }
      checkManifest(label, target, version, expectGeckoId);
    }

    if (process.env['SMOKE_SKIP_BROWSER'] === '1') {
      console.warn('SMOKE_SKIP_BROWSER=1: the Firefox runtime check was skipped.');
    } else {
      await checkFirefoxRuntime(firefoxZip);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    console.error('Smoke test FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }
  console.log('Smoke test OK.');
}

await main();
