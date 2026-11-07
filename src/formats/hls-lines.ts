import { fail, ok, type Result } from '../core/result.ts';
import type { HlsByteRange } from './hls-types.ts';

export type AttributeMap = ReadonlyMap<string, string>;

export interface TagLine {
  /** Including the leading `#`, for example `#EXTINF`. */
  name: string;
  value: string;
}

const BYTE_ORDER_MARK = '﻿';
const TAG_PREFIX = '#EXT';
const ATTRIBUTE_PATTERN = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g;
const RESOLUTION_PATTERN = /^(\d+)x(\d+)$/i;
const BYTE_RANGE_PATTERN = /^(\d+)(?:@(\d+))?$/;

/** The non-empty lines of a playlist, trimmed, without a byte order mark. */
export function playlistLines(text: string): string[] {
  return text
    .replace(BYTE_ORDER_MARK, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** The tag a line holds, or undefined for an address line or a plain comment. */
export function parseTag(line: string): TagLine | undefined {
  if (!line.startsWith(TAG_PREFIX)) {
    return undefined;
  }

  const colon = line.indexOf(':');
  if (colon < 0) {
    return { name: line, value: '' };
  }
  return { name: line.slice(0, colon), value: line.slice(colon + 1) };
}

/** `KEY=value,KEY="quoted, value"` as a map; quotes are removed, keys are upper-cased. */
export function parseAttributeList(text: string): AttributeMap {
  const attributes = new Map<string, string>();
  for (const match of text.matchAll(ATTRIBUTE_PATTERN)) {
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) {
      continue;
    }
    const value = rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;
    attributes.set(key.toUpperCase(), value);
  }
  return attributes;
}

export function parseResolution(text: string | undefined): { width: number; height: number } | undefined {
  const match = text === undefined ? null : RESOLUTION_PATTERN.exec(text);
  if (!match) {
    return undefined;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  return { width, height };
}

/** A positive number, or undefined when the text is missing or not one. */
export function parsePositiveNumber(text: string | undefined): number | undefined {
  if (text === undefined) {
    return undefined;
  }

  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

/**
 * `length[@offset]`. A range without an offset continues after the previous
 * one, so the caller passes where that ended (`defaultOffset`); without one the
 * range cannot be placed and the result is an error.
 */
export function parseByteRange(text: string, defaultOffset: number | undefined): Result<HlsByteRange> {
  const match = BYTE_RANGE_PATTERN.exec(text.trim());
  if (!match) {
    return fail(`Bad byte range: ${text}`);
  }

  const length = Number(match[1]);
  const offset = match[2] === undefined ? defaultOffset : Number(match[2]);
  if (offset === undefined) {
    return fail(`A byte range without a start does not follow another range: ${text}`);
  }
  return ok({ offset, length });
}
