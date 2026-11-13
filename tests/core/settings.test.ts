import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  renderFilename,
  validateSettings,
  validateTemplate,
  type TemplateValues,
} from '../../src/core/settings.ts';

const VALUES: TemplateValues = { title: 'My Video', site: 'example.com', quality: '720p', date: '2026-11-06' };

describe('normalizeSettings', () => {
  test.each([
    ['null', null],
    ['a string', 'settings'],
    ['an empty object', {}],
    ['wrong types', { inPageButton: 'yes', contextMenu: 1, filenameTemplate: 5, defaultQuality: 'huge' }],
    ['an unknown placeholder', { filenameTemplate: '{nope}' }],
  ])('falls back to the defaults for %s', (_name, raw) => {
    expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  test('keeps valid values and fixes only the bad ones', () => {
    const result = normalizeSettings({
      inPageButton: false,
      contextMenu: 'maybe',
      filenameTemplate: '{site} - {title}',
      defaultQuality: '480p',
    });

    expect(result).toEqual({
      inPageButton: false,
      contextMenu: true,
      filenameTemplate: '{site} - {title}',
      defaultQuality: '480p',
      playerCapture: false,
      playerCaptureSites: ['youtube.com'],
    });
  });

  test.each([
    ['a list is cleaned: bad entries dropped, names lower-cased, repeats removed', ['Example.COM', 'not a site', 5, 'example.com', '*.other.org'], ['example.com', 'other.org']],
    ['an empty list stays empty (everything is switched off)', [], []],
    ['a missing list gives the default list', undefined, DEFAULT_SETTINGS.playerCaptureSites],
    ['a list of the wrong type gives the default list', 'youtube.com', DEFAULT_SETTINGS.playerCaptureSites],
  ])('player capture sites: %s', (_name, raw, expected) => {
    expect(normalizeSettings({ playerCaptureSites: raw }).playerCaptureSites).toEqual(expected);
  });

  test('the player capture is off unless a stored setting says it is on', () => {
    expect(normalizeSettings({}).playerCapture).toBe(false);
    expect(normalizeSettings({ playerCapture: true }).playerCapture).toBe(true);
    expect(normalizeSettings({ playerCapture: 'yes' }).playerCapture).toBe(false);
  });
});

describe('validateTemplate', () => {
  test.each([
    ['the default template', DEFAULT_SETTINGS.filenameTemplate],
    ['plain text', 'video'],
    ['every placeholder', '{title} {site} {quality} {date}'],
  ])('accepts %s', (_name, template) => {
    expect(validateTemplate(template).ok).toBe(true);
  });

  test.each([
    ['an empty template', ''],
    ['only spaces', '   '],
    ['an unknown placeholder', '{title} {author}'],
    ['an empty placeholder', '{}'],
  ])('rejects %s with a message', (_name, template) => {
    const result = validateTemplate(template);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).not.toBe('');
  });
});

describe('validateSettings', () => {
  test('accepts the defaults', () => {
    expect(validateSettings(DEFAULT_SETTINGS).ok).toBe(true);
  });

  test('rejects a bad template', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, filenameTemplate: '{x}' }).ok).toBe(false);
  });

  test.each([
    ['a site that is an address with a path', ['https://youtube.com/watch']],
    ['a site with spaces inside', ['you tube']],
    ['too many sites', Array.from({ length: 51 }, (_, index) => `site${index}.example`)],
  ])('rejects %s', (_name, playerCaptureSites) => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, playerCaptureSites }).ok).toBe(false);
  });
});

describe('renderFilename', () => {
  test.each([
    ['the default template', '{title} [{quality}]', 'My Video [720p]'],
    ['all placeholders', '{site}_{date}_{title}_{quality}', 'example.com_2026-11-06_My Video_720p'],
    ['no placeholders', 'clip', 'clip'],
    ['an invalid template', '{nope}', 'My Video [720p]'],
  ])('renders %s', (_name, template, expected) => {
    expect(renderFilename(template, VALUES)).toBe(expected);
  });

  test.each([
    ['forbidden characters', 'a<b>c:d"e/f\\g|h?i*j', 'a_b_c_d_e_f_g_h_i_j'],
    ['trailing dots and spaces', 'name. . ', 'name'],
    ['repeated whitespace', 'a   b\t c', 'a b c'],
    ['nothing usable', '...', 'video'],
  ])('cleans %s from the title', (_name, title, expected) => {
    expect(renderFilename('{title}', { ...VALUES, title })).toBe(expected);
  });

  test('limits the length', () => {
    const name = renderFilename('{title}', { ...VALUES, title: 'x'.repeat(500) });

    expect(name).toHaveLength(150);
  });
});
