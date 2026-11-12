import type { MediaItem, PartRun } from './media.ts';

/** The files a manifest names, as `MediaItem` keeps them: single addresses and numbered runs. */
export interface StreamParts {
  partUrls: string[];
  partRuns: PartRun[];
}

/** Fewer numbered addresses than this are kept one by one. */
export const MIN_RUN_LENGTH = 3;
/** Limits that keep a huge manifest from filling the storage; the rest is simply not recognised. */
export const MAX_PART_URLS = 200;
export const MAX_PART_RUNS = 50;

const NUMBERED = /^(.*?)(\d+)(\D*)$/s;
/** The file extension: a dot and a name that starts with a letter, so ".mp4" counts and ".0.1" does not. */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]*$/;

/** The address without its query and fragment: signed segment addresses differ in the query only. */
function withoutQuery(address: string): string {
  if (!URL.canParse(address)) {
    return address;
  }
  const url = new URL(address);
  return `${url.origin}${url.pathname}`;
}

/** Splits an address at the last number before its extension ("seg-12.mp4": "seg-", "12", ".mp4"). */
function splitAtNumber(address: string): PartRun | undefined {
  const key = withoutQuery(address);
  const extension = EXTENSION.exec(key)?.[0] ?? '';
  const match = NUMBERED.exec(key.slice(0, key.length - extension.length));
  if (match === null) {
    return undefined;
  }
  return { prefix: match[1] ?? '', suffix: `${match[3] ?? ''}${extension}` };
}

/**
 * Folds the addresses a manifest names into what is cheap to keep: addresses
 * that differ only in their last number (`seg-1.mp4`, `seg-2.mp4`, ...) become
 * one run, the others stay as they are.
 */
export function collectParts(addresses: readonly string[]): StreamParts {
  const groups = new Map<string, { run: PartRun; members: string[] }>();
  const loose: string[] = [];

  for (const address of new Set(addresses)) {
    const run = splitAtNumber(address);
    if (run === undefined) {
      loose.push(address);
      continue;
    }

    const key = `${run.prefix}\u0000${run.suffix}`;
    const group = groups.get(key) ?? { run, members: [] };
    group.members.push(address);
    groups.set(key, group);
  }

  const partRuns: PartRun[] = [];
  for (const group of groups.values()) {
    if (group.members.length >= MIN_RUN_LENGTH) {
      partRuns.push(group.run);
    } else {
      loose.push(...group.members);
    }
  }
  return { partUrls: loose.slice(0, MAX_PART_URLS), partRuns: partRuns.slice(0, MAX_PART_RUNS) };
}

function isDigits(text: string): boolean {
  return text !== '' && /^\d+$/.test(text);
}

function matchesRun(run: PartRun, address: string): boolean {
  const key = withoutQuery(address);
  if (!key.startsWith(run.prefix) || !key.endsWith(run.suffix)) {
    return false;
  }
  return isDigits(key.slice(run.prefix.length, key.length - run.suffix.length));
}

/** True when `stream` names `address` as one of its parts. */
export function isPartOf(stream: Pick<MediaItem, 'partUrls' | 'partRuns'>, address: string): boolean {
  if (stream.partUrls?.includes(address) === true) {
    return true;
  }
  return stream.partRuns?.some((run) => matchesRun(run, address)) === true;
}
