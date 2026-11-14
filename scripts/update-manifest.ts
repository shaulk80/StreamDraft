import { fail, ok, type Result } from '../src/core/result.ts';

// Builds the update manifest that Firefox reads from `update_url`
// (decision 0011). Pure functions: the command line is in make-update-manifest.ts.

export interface AddonInfo {
  id: string;
  version: string;
  strictMinVersion?: string;
}

export interface UpdateInput extends AddonInfo {
  /** HTTPS address of the signed .xpi of this version. */
  updateLink: string;
  /** SHA-256 of that .xpi, 64 hex characters. */
  sha256: string;
}

export interface UpdateEntry {
  version: string;
  update_link: string;
  update_hash: string;
  applications?: { gecko: { strict_min_version: string } };
}

export interface UpdateManifest {
  addons: Record<string, { updates: UpdateEntry[] }>;
}

const versionPattern = /^\d+(\.\d+){0,3}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

/** Reads the add-on ID, version and lowest Firefox version from a Firefox manifest.json. */
export function readAddonInfo(manifest: unknown): Result<AddonInfo> {
  if (typeof manifest !== 'object' || manifest === null) {
    return fail('manifest.json is not an object');
  }
  const { version, browser_specific_settings: settings } = manifest as {
    version?: unknown;
    browser_specific_settings?: { gecko?: { id?: unknown; strict_min_version?: unknown } };
  };
  const id = settings?.gecko?.id;
  const strictMinVersion = settings?.gecko?.strict_min_version;
  if (typeof version !== 'string') {
    return fail('manifest.json has no "version"');
  }
  if (typeof id !== 'string' || id === '') {
    return fail('manifest.json has no browser_specific_settings.gecko.id');
  }
  if (strictMinVersion !== undefined && typeof strictMinVersion !== 'string') {
    return fail('browser_specific_settings.gecko.strict_min_version is not a string');
  }
  return ok({ id, version, strictMinVersion });
}

export function buildUpdateManifest(input: UpdateInput): Result<UpdateManifest> {
  if (!versionPattern.test(input.version)) {
    return fail(`"${input.version}" is not a plain dotted version such as 0.1.0`);
  }
  if (!sha256Pattern.test(input.sha256)) {
    return fail('the SHA-256 must be 64 lower-case hex characters');
  }
  if (!isHttpsUrl(input.updateLink)) {
    return fail(`the update link must be an https address, got "${input.updateLink}"`);
  }
  if (input.id === '') {
    return fail('the add-on ID is empty');
  }

  const entry: UpdateEntry = {
    version: input.version,
    update_link: input.updateLink,
    update_hash: `sha256:${input.sha256}`,
  };
  if (input.strictMinVersion !== undefined) {
    entry.applications = { gecko: { strict_min_version: input.strictMinVersion } };
  }
  return ok({ addons: { [input.id]: { updates: [entry] } } });
}

function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === 'https:';
  } catch {
    return false;
  }
}
