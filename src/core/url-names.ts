/** A bad %-escape in an address must not hide the video; show the text as it is. */
export function decodeForDisplay(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch (error) {
    console.warn('StreamDraft: address has a bad %-escape, showing it as is', error);
    return text;
  }
}

/** The last part of an address path, decoded, with its extension; empty when the path ends in a slash. */
export function fileNameOf(pathname: string): string {
  const lastSegment = pathname.split('/').pop() ?? '';
  return decodeForDisplay(lastSegment).trim();
}

/** The file name of an address, or empty when `address` is not a valid address. */
export function fileNameOfAddress(address: string): string {
  if (!URL.canParse(address)) {
    return '';
  }
  return fileNameOf(new URL(address).pathname);
}

/**
 * The address without its fragment ("#t=10"), or undefined when `address` is
 * not valid. Two links to the same file are the same video; this is the id
 * the page, the background and the context menu all agree on.
 */
export function addressWithoutFragment(address: string): string | undefined {
  if (!URL.canParse(address)) {
    return undefined;
  }

  const url = new URL(address);
  url.hash = '';
  return url.href;
}
