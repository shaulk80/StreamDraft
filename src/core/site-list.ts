import { fail, ok, type Result } from '../core/result.ts';

/** More sites than this is a typing mistake, and every site is a match pattern to register. */
export const MAX_CAPTURE_SITES = 50;

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const SITE_NAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const SEPARATORS = /[\s,;]+/;

/**
 * One site as the user may write it: `youtube.com`, `*.youtube.com` or with
 * capitals. Returns the plain lower-case name (a site always includes its
 * subdomains), or an error that says what to write.
 */
export function normalizeSite(text: string): Result<string> {
  const name = text.trim().toLowerCase().replace(/^\*\./, '');
  if (!SITE_NAME.test(name)) {
    return fail(`"${text.trim()}" is not a site name. Write only the name, such as youtube.com.`);
  }
  return ok(name);
}

/** The sites in a text with one site per line (commas and spaces also separate). Empty lines are skipped; a repeated site counts once. */
export function parseSiteList(text: string): Result<string[]> {
  const sites: string[] = [];
  for (const word of text.split(SEPARATORS)) {
    if (word === '') {
      continue;
    }

    const site = normalizeSite(word);
    if (!site.ok) {
      return site;
    }
    if (!sites.includes(site.value)) {
      sites.push(site.value);
    }
  }

  if (sites.length > MAX_CAPTURE_SITES) {
    return fail(`Too many sites (the most is ${MAX_CAPTURE_SITES}).`);
  }
  return ok(sites);
}

export function formatSiteList(sites: readonly string[]): string {
  return sites.join('\n');
}

/**
 * Browser match patterns for the sites: the site itself and its subdomains.
 * An address (`127.0.0.1`) or a name without a dot (`localhost`) has no
 * subdomains to match.
 */
export function matchPatternsFor(sites: readonly string[]): string[] {
  return sites.flatMap((site) => {
    const hasSubdomains = site.includes('.') && !IPV4.test(site);
    return hasSubdomains ? [`*://${site}/*`, `*://*.${site}/*`] : [`*://${site}/*`];
  });
}
