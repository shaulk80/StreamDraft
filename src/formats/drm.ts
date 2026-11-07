/** Used when a stream says it is protected but the scheme is not one we know by name. */
export const UNKNOWN_PROTECTION = 'DRM protection';

interface KnownScheme {
  /** Lower-case text that identifies the scheme in a key format or a scheme address. */
  markers: string[];
  name: string;
}

const KNOWN_SCHEMES: readonly KnownScheme[] = [
  { markers: ['edef8ba9-79d6-4ace-a3c8-27dcd51d21ed', 'widevine'], name: 'Widevine DRM' },
  { markers: ['9a04f079-9840-4286-ab92-e65be0885f95', 'playready'], name: 'PlayReady DRM' },
  { markers: ['94ce86fb-07ff-4f43-adb8-93d2fa968ca2', 'com.apple.streamingkeydelivery', 'fairplay'], name: 'FairPlay DRM' },
  { markers: ['e2719d58-a985-b3c9-781a-b030af78d30e', 'clearkey'], name: 'ClearKey encryption' },
];

/**
 * The name of a copy-protection scheme for the popup ("Widevine DRM"), from an
 * HLS key format or a DASH `schemeIdUri`; undefined when it is not one we know.
 * Shared by the HLS and DASH parsers: a protected stream is listed, never downloaded.
 */
export function protectionName(identifier: string): string | undefined {
  const lower = identifier.toLowerCase();
  const scheme = KNOWN_SCHEMES.find((candidate) => candidate.markers.some((marker) => lower.includes(marker)));
  return scheme?.name;
}
