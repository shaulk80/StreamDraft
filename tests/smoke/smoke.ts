import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { Builder, By, until } from 'selenium-webdriver';
import * as firefox from 'selenium-webdriver/firefox.js';
import { startTestPageServer } from '../pages/server.ts';

// Smoke test of the PACKAGES (not the build output folder):
//   1. extract each zip into an empty folder and check its manifest;
//   2. load the Firefox package in a real (headless) Firefox, open the popup and
//      check that the background script answers.
// Chrome is checked statically only; running it is added in a later milestone.
// Set SMOKE_SKIP_BROWSER=1 to skip step 2 (for machines without Firefox).
// Set FIREFOX_BIN to use a specific Firefox binary.

const ADDON_ID = 'streamdraft@shaulk80.github.io';
const FIXED_UUID = 'f3c2a9e0-6b1d-4d2a-9a55-3b7c1e0d4a10';
const WAIT_MS = 20_000;

const root = path.resolve(import.meta.dirname, '..', '..');
const packageDir = path.join(root, 'dist', 'packages');
const problems: string[] = [];

interface Manifest {
  manifest_version?: number;
  name?: string;
  version?: string;
  action?: { default_popup?: string };
  background?: unknown;
  browser_specific_settings?: { gecko?: { id?: string } };
}

function readVersion(): string {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  return packageJson.version;
}

function extract(zipPath: string, targetDir: string): void {
  const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) {
      continue;
    }
    const target = path.join(targetDir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
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
  await driver.wait(until.elementTextContains(result, 'Demo only'), WAIT_MS);
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
const EXPECTED_FILES = ['clip.webm', 'direct.mp4', 'hidden-stream', 'late.mp4', 'song.mp3'];

async function listedFileNames(driver: firefox.Driver): Promise<string[]> {
  const metas = await driver.findElements(By.css('#media-list .meta'));
  const texts = await Promise.all(metas.map(async (meta) => meta.getText()));
  // The line reads "site · kind · file name".
  return texts.map((text) => text.split(' · ').pop() ?? '').sort();
}

async function checkDetection(driver: firefox.Driver, pageUrl: string): Promise<void> {
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
  console.log(`Firefox runtime: detection lists ${EXPECTED_FILES.length} files for the test page (page scan and network observer), not the tiny one`);
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

// The right-click entry exists, answers a click with the demo toast, and follows
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
  if (!toastText.includes('Demo only')) {
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
      await checkDetection(driver, testPage.url);
    } finally {
      await testPage.close();
    }
    await checkOptionsPage(driver);
  } catch (error) {
    console.error(error);
    problems.push('firefox runtime: a page check failed (see the error above)');
  } finally {
    await driver.quit();
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
