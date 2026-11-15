/** Where the plain-words explanation of the permissions and the privacy statement are kept (the README). */
export const PROJECT_URL = 'https://github.com/shaulk80/StreamDraft';
export const PERMISSIONS_URL = `${PROJECT_URL}#permissions`;
export const PRIVACY_URL = `${PROJECT_URL}#privacy`;

/** The version line of the popup and the options page. A manifest without a version says so. */
export function versionLabel(version: string | undefined): string {
  const trimmed = version?.trim();
  if (trimmed === undefined || trimmed === '') {
    return 'Version unknown';
  }
  return `Version ${trimmed}`;
}
