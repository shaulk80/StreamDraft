/**
 * The absolute address `reference` points to when read on the page at `base`,
 * or undefined when either is not a valid address. Manifests (HLS now, DASH
 * next) list segments and playlists relative to their own address.
 */
export function resolveUrl(reference: string, base: string): string | undefined {
  if (!URL.canParse(reference, base)) {
    return undefined;
  }
  return new URL(reference, base).href;
}
