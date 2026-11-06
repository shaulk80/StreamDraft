import { renderFilename, validateSettings, QUALITIES, type Settings } from '../core/settings.ts';
import { MOCK_MEDIA } from '../core/mock-media.ts';
import type { Result } from '../core/result.ts';

/** The form controls of the options page, looked up once. */
export interface OptionsControls {
  inPageButton: HTMLInputElement;
  contextMenu: HTMLInputElement;
  filenameTemplate: HTMLInputElement;
  defaultQuality: HTMLSelectElement;
  preview: HTMLElement;
  status: HTMLElement;
}

function byId<T extends HTMLElement>(root: Document, id: string): T | undefined {
  return (root.getElementById(id) as T | null) ?? undefined;
}

/** Returns the controls, or undefined (and logs) when the page is missing one. */
export function findControls(root: Document): OptionsControls | undefined {
  const controls = {
    inPageButton: byId<HTMLInputElement>(root, 'in-page-button'),
    contextMenu: byId<HTMLInputElement>(root, 'context-menu'),
    filenameTemplate: byId<HTMLInputElement>(root, 'filename-template'),
    defaultQuality: byId<HTMLSelectElement>(root, 'default-quality'),
    preview: byId<HTMLElement>(root, 'filename-preview'),
    status: byId<HTMLElement>(root, 'form-status'),
  };

  const missing = Object.entries(controls)
    .filter(([, element]) => element === undefined)
    .map(([name]) => name);
  if (missing.length > 0) {
    console.error(`StreamDraft: options page is missing controls: ${missing.join(', ')}`);
    return undefined;
  }
  return controls as OptionsControls;
}

export function fillQualityChoices(select: HTMLSelectElement): void {
  for (const quality of QUALITIES) {
    const option = select.ownerDocument.createElement('option');
    option.value = quality;
    option.textContent = quality === 'best' ? 'Best available' : quality === 'audio' ? 'Audio only' : quality;
    select.append(option);
  }
}

/** Shows `settings` in the form. Skips fields that already match, so typing is not disturbed. */
export function writeSettings(controls: OptionsControls, settings: Settings): void {
  controls.inPageButton.checked = settings.inPageButton;
  controls.contextMenu.checked = settings.contextMenu;
  if (controls.filenameTemplate.value !== settings.filenameTemplate) {
    controls.filenameTemplate.value = settings.filenameTemplate;
  }
  controls.defaultQuality.value = settings.defaultQuality;
  showPreview(controls, settings);
}

/** Reads the form. The result carries the message to show when a value is not usable. */
export function readSettings(controls: OptionsControls): Result<Settings> {
  return validateSettings({
    inPageButton: controls.inPageButton.checked,
    contextMenu: controls.contextMenu.checked,
    filenameTemplate: controls.filenameTemplate.value,
    defaultQuality: controls.defaultQuality.value as Settings['defaultQuality'],
  });
}

export function showPreview(controls: OptionsControls, settings: Pick<Settings, 'filenameTemplate'>): void {
  const sample = MOCK_MEDIA[1];
  const name = renderFilename(settings.filenameTemplate, {
    title: sample?.title ?? 'Video',
    site: sample?.site ?? 'example.com',
    quality: '720p',
    date: new Date().toISOString().slice(0, 10),
  });
  controls.preview.textContent = `${name}.mp4`;
}

export function showStatus(controls: OptionsControls, message: string, isError: boolean): void {
  controls.status.textContent = message;
  controls.status.classList.toggle('error', isError);
}
