import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { Builder, By, until } from 'selenium-webdriver';
import * as firefox from 'selenium-webdriver/firefox.js';

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
    await openInNewTab(driver, `moz-extension://${FIXED_UUID}/popup.html`);

    const heading = await driver.wait(until.elementLocated(By.css('h1')), WAIT_MS);
    const headingText = await heading.getText();
    if (headingText !== 'StreamDraft') {
      problems.push(`firefox runtime: popup heading was "${headingText}"`);
    }

    const status = driver.findElement(By.id('status'));
    await driver.wait(until.elementTextContains(status, 'ready'), WAIT_MS);
    console.log(`Firefox runtime: popup shows "${await status.getText()}"`);

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
