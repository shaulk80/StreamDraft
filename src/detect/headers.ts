export interface HeaderLike {
  name: string;
  value?: string;
}

/** The value of a response header, whatever the case of its name; undefined when absent. */
export function headerValue(headers: readonly HeaderLike[] | undefined, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return headers?.find((header) => header.name.toLowerCase() === wanted)?.value;
}

const CONTENT_RANGE_TOTAL = /^bytes\s+(?:\d+-\d+|\*)\/(\d+)$/i;

/**
 * The size of the whole file a response belongs to. A partial response (206)
 * carries the total after the slash of Content-Range; its Content-Length is
 * only the size of the piece, so it is never used. Undefined when not known.
 */
export function totalSizeOf(statusCode: number, headers: readonly HeaderLike[] | undefined): number | undefined {
  if (statusCode === 206) {
    const range = headerValue(headers, 'content-range')?.trim() ?? '';
    return parseWholeNumber(CONTENT_RANGE_TOTAL.exec(range)?.[1]);
  }
  return parseWholeNumber(headerValue(headers, 'content-length')?.trim());
}

function parseWholeNumber(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d+$/.test(text)) {
    return undefined;
  }
  return Number(text);
}
