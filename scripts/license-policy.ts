export type LicenseVerdict = 'allowed' | 'warn' | 'denied';

const DENIED = /^(A?GPL|SSPL|BUSL|CC-BY-NC|CC-BY-ND)/i;
const WARN = /^(LGPL|MPL|EPL|CDDL|UNKNOWN|SEE LICENSE)/i;

function classifyToken(token: string): LicenseVerdict {
  if (DENIED.test(token)) {
    return 'denied';
  }
  if (WARN.test(token)) {
    return 'warn';
  }
  return 'allowed';
}

/**
 * Judges an SPDX-style license expression for a dependency that is bundled
 * into a redistributed Apache-2.0 extension. "A OR B" lets the user choose, so
 * the best alternative counts; "A AND B" needs all parts, so the worst counts.
 */
export function classifyLicense(expression: string): LicenseVerdict {
  const rank: Record<LicenseVerdict, number> = { allowed: 0, warn: 1, denied: 2 };
  const alternatives = expression.split(/\s+OR\s+/i);

  const verdicts = alternatives.map((alternative) => {
    const tokens = alternative
      .split(/\s+AND\s+|[\s()]+/i)
      .filter((token) => token !== '' && token.toUpperCase() !== 'AND');
    if (tokens.length === 0) {
      return 'warn' as LicenseVerdict;
    }
    return tokens.map(classifyToken).reduce((worst, next) => (rank[next] > rank[worst] ? next : worst));
  });

  return verdicts.reduce((best, next) => (rank[next] < rank[best] ? next : best));
}
