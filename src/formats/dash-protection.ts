import { protectionName, UNKNOWN_PROTECTION } from './drm.ts';
import { childrenNamed, type XmlElement } from './xml.ts';

const COMMON_ENCRYPTION_SCHEME = 'mp4protection';
const COMMON_ENCRYPTION_NAME = 'Common encryption (CENC)';

/**
 * What protects the content, from the `ContentProtection` elements of the
 * given elements (a representation and its adaptation set); undefined when
 * there are none. Any such element means the media is encrypted and cannot be
 * saved: a DRM system is named when one is declared, otherwise the generic
 * common-encryption marker, otherwise a general message.
 */
export function protectionOf(elements: XmlElement[]): string | undefined {
  const schemes = elements
    .flatMap((element) => childrenNamed(element, 'ContentProtection'))
    .map((protection) => protection.attributes.get('schemeIdUri') ?? '');
  if (schemes.length === 0) {
    return undefined;
  }

  const named = schemes.map(protectionName).find((name) => name !== undefined);
  if (named !== undefined) {
    return named;
  }
  if (schemes.some((scheme) => scheme.toLowerCase().includes(COMMON_ENCRYPTION_SCHEME))) {
    return COMMON_ENCRYPTION_NAME;
  }
  return UNKNOWN_PROTECTION;
}
