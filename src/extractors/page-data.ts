import type { PageData } from '../core/page-data.ts';
import { fail, ok, type Result } from '../core/result.ts';

/**
 * Data a site extractor needs from the page's own scripts. A content script in
 * the MAIN world reads the page variables named here and posts them with
 * `window.postMessage`; the extension's isolated content script receives them
 * and passes them on to the background. The page can post the same message, so
 * everything that arrives is untrusted page content, like the page itself.
 */
export const PAGE_DATA_CHANNEL = 'streamdraft:page-data';

/** Page variables the MAIN-world script may read. Anything else is ignored, so the list is the whole reach of that script. */
export const PAGE_VARIABLES: readonly string[] = ['ytInitialPlayerResponse'];

/** A larger value is dropped: it is not a player response, and the background keeps what it is sent. */
export const MAX_PAGE_DATA_CHARS = 2_000_000;

/** The value of a page variable as the message `window.postMessage` carries, or an error when it cannot be sent. */
export function pageDataPost(name: string, value: unknown): Result<Record<string, string>> {
  if (!PAGE_VARIABLES.includes(name)) {
    return fail(`Not a variable the extension reads: ${name}`);
  }

  const json = serialize(value);
  if (json === undefined) {
    return fail(`The value of ${name} cannot be sent as JSON.`);
  }
  if (json.length > MAX_PAGE_DATA_CHARS) {
    return fail(`The value of ${name} is too large (${json.length} characters).`);
  }
  return ok({ channel: PAGE_DATA_CHANNEL, name, json });
}

/** The page data inside a `message` event's data, or an error when the event is something else. */
export function parsePageDataPost(data: unknown): Result<PageData> {
  if (typeof data !== 'object' || data === null) {
    return fail('Not a page data message.');
  }

  const { channel, name, json } = data as Record<string, unknown>;
  if (channel !== PAGE_DATA_CHANNEL || typeof name !== 'string' || typeof json !== 'string') {
    return fail('Not a page data message.');
  }
  return checkPageData({ name, json });
}

/** The page data itself when it names a variable the extension reads and is not too large. */
export function checkPageData(data: PageData): Result<PageData> {
  if (!PAGE_VARIABLES.includes(data.name)) {
    return fail(`Page data refused, not a variable the extension reads: ${data.name}`);
  }
  if (data.json.length > MAX_PAGE_DATA_CHARS) {
    return fail(`Page data refused, ${data.name} is too large.`);
  }
  return ok(data);
}

function serialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch (error) {
    // A cyclic or throwing value: reported by the caller as a result, the detail goes to the log.
    console.error('StreamDraft: a page variable could not be turned into JSON', error);
    return undefined;
  }
}
