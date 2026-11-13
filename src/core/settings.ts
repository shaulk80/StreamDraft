import { MAX_CAPTURE_SITES, normalizeSite } from './site-list.ts';
import { fail, ok, type Result } from './result.ts';

export const QUALITIES = ['best', '1080p', '720p', '480p', '360p', 'audio'] as const;
export type Quality = (typeof QUALITIES)[number];

export interface Settings {
  inPageButton: boolean;
  contextMenu: boolean;
  filenameTemplate: string;
  defaultQuality: Quality;
  /** Experimental: record the video a page's player plays (M4). Off unless the user switches it on. */
  playerCapture: boolean;
  /** The only sites the player capture runs on (with their subdomains), plain names such as `youtube.com`. */
  playerCaptureSites: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  inPageButton: true,
  contextMenu: true,
  filenameTemplate: '{title} [{quality}]',
  defaultQuality: 'best',
  playerCapture: false,
  playerCaptureSites: ['youtube.com'],
};

/** Storage key under which the settings object is kept. */
export const SETTINGS_KEY = 'settings';

export function isQuality(value: unknown): value is Quality {
  return QUALITIES.includes(value as Quality);
}

/**
 * Turns whatever was stored into valid settings. Bad or missing fields fall
 * back to their defaults, so a corrupt store never breaks the extension.
 */
export function normalizeSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_SETTINGS };
  }

  const candidate = raw as Partial<Record<keyof Settings, unknown>>;
  const template = candidate.filenameTemplate;
  const templateIsValid = typeof template === 'string' && validateTemplate(template).ok;

  return {
    inPageButton:
      typeof candidate.inPageButton === 'boolean' ? candidate.inPageButton : DEFAULT_SETTINGS.inPageButton,
    contextMenu: typeof candidate.contextMenu === 'boolean' ? candidate.contextMenu : DEFAULT_SETTINGS.contextMenu,
    filenameTemplate: templateIsValid ? template : DEFAULT_SETTINGS.filenameTemplate,
    defaultQuality: isQuality(candidate.defaultQuality) ? candidate.defaultQuality : DEFAULT_SETTINGS.defaultQuality,
    playerCapture:
      typeof candidate.playerCapture === 'boolean' ? candidate.playerCapture : DEFAULT_SETTINGS.playerCapture,
    playerCaptureSites: normalizeSites(candidate.playerCaptureSites),
  };
}

/** The usable sites of a stored list; a missing or broken list gives the default one, an empty list stays empty. */
function normalizeSites(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_SETTINGS.playerCaptureSites];
  }

  const sites: string[] = [];
  for (const entry of raw.slice(0, MAX_CAPTURE_SITES)) {
    const site = typeof entry === 'string' ? normalizeSite(entry) : undefined;
    if (site?.ok === true && !sites.includes(site.value)) {
      sites.push(site.value);
    }
  }
  return sites;
}

/** Checks settings coming from the options page; the error is shown to the user. */
export function validateSettings(settings: Settings): Result<Settings> {
  const template = validateTemplate(settings.filenameTemplate);
  if (!template.ok) {
    return template;
  }
  if (!isQuality(settings.defaultQuality)) {
    return fail(`Unknown quality: ${String(settings.defaultQuality)}`);
  }
  if (settings.playerCaptureSites.length > MAX_CAPTURE_SITES) {
    return fail(`Too many sites (the most is ${MAX_CAPTURE_SITES}).`);
  }
  for (const site of settings.playerCaptureSites) {
    const checked = normalizeSite(site);
    if (!checked.ok) {
      return checked;
    }
  }
  return ok(settings);
}

export const TEMPLATE_PLACEHOLDERS = ['title', 'site', 'quality', 'date'] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];
export type TemplateValues = Record<TemplatePlaceholder, string>;

const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;
const MAX_FILENAME_LENGTH = 150;
const FALLBACK_FILENAME = 'video';

/** Returns the template when it is usable, or a message saying what is wrong. */
export function validateTemplate(template: string): Result<string> {
  if (template.trim() === '') {
    return fail('The filename template is empty.');
  }

  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1] ?? '';
    if (!TEMPLATE_PLACEHOLDERS.includes(name as TemplatePlaceholder)) {
      return fail(`Unknown placeholder {${name}}. Use ${TEMPLATE_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`);
    }
  }

  return ok(template);
}

// Characters Windows (and so the downloads API) refuses in a file name, plus control characters.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Builds a file name (without extension) from a template. Always returns a
 * usable name: an invalid template falls back to the default one.
 */
export function renderFilename(template: string, values: TemplateValues): string {
  const usable = validateTemplate(template).ok ? template : DEFAULT_SETTINGS.filenameTemplate;
  const filled = usable.replace(PLACEHOLDER_PATTERN, (_whole, name: string) => values[name as TemplatePlaceholder]);

  const cleaned = filled
    .replace(/\s+/g, ' ')
    .replace(FORBIDDEN_CHARACTERS, '_')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    .replace(/[. ]+$/, '');

  return cleaned === '' ? FALLBACK_FILENAME : cleaned;
}
