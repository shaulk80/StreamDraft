const DURATION_PATTERN =
  /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
const TEMPLATE_PATTERN = /\$([A-Za-z]*)(?:%0(\d+)d)?\$/g;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;
/** The usual approximations for calendar units in a media duration. */
const SECONDS_PER_MONTH = 30 * SECONDS_PER_DAY;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;
const DURATION_UNIT_SECONDS = [
  SECONDS_PER_YEAR,
  SECONDS_PER_MONTH,
  SECONDS_PER_WEEK,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
  1,
];

/** An ISO 8601 duration such as `PT1H2M3.5S` in seconds, or undefined when it is not one (or is empty). */
export function parseIsoDuration(text: string | undefined): number | undefined {
  const match = text === undefined ? null : DURATION_PATTERN.exec(text.trim());
  if (!match || match.slice(1).every((part) => part === undefined)) {
    return undefined;
  }

  let seconds = 0;
  DURATION_UNIT_SECONDS.forEach((unitSeconds, index) => {
    seconds += Number(match[index + 1] ?? 0) * unitSeconds;
  });
  return seconds;
}

/** `30` or `30000/1001` as frames per second; undefined when it is neither. */
export function parseFrameRate(text: string | undefined): number | undefined {
  if (text === undefined) {
    return undefined;
  }

  const [numeratorText, denominatorText] = text.split('/');
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
    return undefined;
  }
  return numerator / denominator;
}

/** A finite number of at least `minimum`, or undefined. */
export function parseNumberAttribute(text: string | undefined, minimum = 0): number | undefined {
  if (text === undefined || text.trim() === '') {
    return undefined;
  }

  const value = Number(text);
  if (!Number.isFinite(value) || value < minimum) {
    return undefined;
  }
  return value;
}

/** `start-end` (both included) as a byte range, or undefined when it is not one. */
export function parseRangeAttribute(text: string | undefined): { offset: number; length: number } | undefined {
  const match = text === undefined ? null : /^(\d+)-(\d+)$/.exec(text.trim());
  if (!match) {
    return undefined;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end < start) {
    return undefined;
  }
  return { offset: start, length: end - start + 1 };
}

/**
 * Fills in a segment template: `$Number$`, `$Time$`, `$Bandwidth$`,
 * `$RepresentationID$`, with `%05d`-style zero padding and `$$` for a dollar
 * sign. Undefined when the template uses an identifier that has no value.
 */
export function expandTemplate(template: string, values: Readonly<Record<string, string | number>>): string | undefined {
  let unknown = false;
  const expanded = template.replace(TEMPLATE_PATTERN, (_match, identifier: string, width: string | undefined) => {
    if (identifier === '') {
      return '$';
    }

    const value = values[identifier];
    if (value === undefined) {
      unknown = true;
      return '';
    }
    if (width === undefined) {
      return String(value);
    }
    return String(value).padStart(Number(width), '0');
  });
  return unknown ? undefined : expanded;
}
