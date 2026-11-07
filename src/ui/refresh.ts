export interface RefreshDeps {
  /** Asks the page to look at its videos again; resolves with its raw answer, rejects when the page cannot be reached. */
  rescanPage(): Promise<unknown>;
  /** Reads the tab's list again and redraws it; resolves with how many videos it holds. */
  reloadList(): Promise<number>;
}

const PAGE_UNREACHABLE =
  'Could not check the page again (reload the page if this keeps happening). The saved list is shown.';

function videosText(count: number): string {
  if (count === 0) {
    return 'No videos found.';
  }
  return count === 1 ? '1 video listed.' : `${count} videos listed.`;
}

/** True when the page answered that it looked at its videos again. */
async function askPage(deps: RefreshDeps): Promise<boolean> {
  try {
    const answer = await deps.rescanPage();
    return (answer as { ok?: unknown } | undefined)?.ok === true;
  } catch (error) {
    console.error('StreamDraft: the page did not answer the refresh request', error);
    return false;
  }
}

/**
 * The popup's Refresh button: the page is asked to report its videos again, then
 * the list is reloaded. The list is reloaded in any case, so a page that cannot
 * be reached (opened before the extension was loaded, a browser page) still shows
 * what is saved. Resolves with the line to show the user.
 */
export async function refreshVideos(deps: RefreshDeps): Promise<string> {
  const pageChecked = await askPage(deps);
  const count = await deps.reloadList();
  if (!pageChecked) {
    return `${PAGE_UNREACHABLE} ${videosText(count)}`;
  }
  return `Checked the page again. ${videosText(count)}`;
}
