// The popup's job display, checked the same way in Firefox (WebDriver) and Chrome (DevTools).
// The page /jobs.html has a slow stream (card 0) and a broken one (card 1).

export const JOBS_PAGE = 'jobs.html';
const POLL_MS = 100;
const JOB_WAIT_MS = 20_000;
const SLOW_CARD = 0;
const BROKEN_CARD = 1;
const FETCHING = /^Downloading: \d+%/;

/** What a card of the popup shows of its job. */
export interface JobCardView {
  text: string;
  /** The value of the progress bar, undefined for a bar that is busy or hidden. */
  progress: number | undefined;
  downloadDisabled: boolean;
  cancelVisible: boolean;
  hasJobPanel: boolean;
}

/** The ways to talk to the popup page, the same in both browsers. */
export interface PopupPage {
  /** Runs statements in the popup. */
  act(statements: string): Promise<void>;
  /** Evaluates an expression whose value is a string. */
  read(expression: string): Promise<string | undefined>;
  /** Loads the popup again, as when it was closed and opened. */
  reload(): Promise<void>;
}

function cardButtonScript(card: number, selector: string): string {
  return `document.querySelectorAll('#media-list .card')[${card}].querySelector('${selector}').click();`;
}

function cardExpression(card: number): string {
  const lines = [
    'JSON.stringify((() => {',
    `const c = document.querySelectorAll('#media-list .card')[${card}];`,
    'if (!c) { return null; }',
    "const panel = c.querySelector('.job');",
    "const bar = panel && panel.querySelector('progress');",
    "const cancel = panel && panel.querySelector('.cancel');",
    "const line = panel ? panel.querySelector('.result') : c.querySelector('.result');",
    'return {',
    '  text: line ? line.textContent : "",',
    "  progress: bar && !bar.hidden && bar.hasAttribute('value') ? bar.value : undefined,",
    "  downloadDisabled: c.querySelector('.download').disabled,",
    '  cancelVisible: !!cancel && !cancel.hidden,',
    '  hasJobPanel: !!panel,',
    '};',
    '})())',
  ];
  return lines.join(' ');
}

async function readCard(popup: PopupPage, card: number): Promise<JobCardView | undefined> {
  const json = await popup.read(cardExpression(card));
  if (json === undefined) {
    return undefined;
  }
  return (JSON.parse(json) as JobCardView | null) ?? undefined;
}

async function waitForCard(popup: PopupPage, card: number, accept: (view: JobCardView) => boolean): Promise<JobCardView | undefined> {
  const deadline = Date.now() + JOB_WAIT_MS;
  while (Date.now() < deadline) {
    const view = await readCard(popup, card);
    if (view !== undefined && accept(view)) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return readCard(popup, card);
}

/**
 * Walks the popup through what a user sees of a stream job: progress (and the job found again when
 * the popup is opened anew), Cancel, and the words for a failure. Returns what went wrong.
 */
export async function checkJobDisplay(popup: PopupPage): Promise<string[]> {
  await popup.act(cardButtonScript(SLOW_CARD, '.download'));
  const fetching = await waitForCard(popup, SLOW_CARD, (view) => FETCHING.test(view.text) && (view.progress ?? 0) > 0);
  if (!fetching || !FETCHING.test(fetching.text) || !fetching.downloadDisabled || !fetching.cancelVisible) {
    return [`the slow stream showed no progress with a Cancel button: ${JSON.stringify(fetching)}`];
  }

  await popup.reload();
  const found = await waitForCard(popup, SLOW_CARD, (view) => view.hasJobPanel && view.downloadDisabled);
  if (!found?.hasJobPanel || !found.downloadDisabled || !found.cancelVisible) {
    return [`the popup, opened again, did not show the running job: ${JSON.stringify(found)}`];
  }

  await popup.act(cardButtonScript(SLOW_CARD, '.cancel'));
  const cancelled = await waitForCard(popup, SLOW_CARD, (view) => view.text === 'Cancelled.' && !view.downloadDisabled);
  if (cancelled?.text !== 'Cancelled.' || cancelled.downloadDisabled || cancelled.cancelVisible) {
    return [`Cancel did not end the job as cancelled: ${JSON.stringify(cancelled)}`];
  }

  await popup.act(cardButtonScript(BROKEN_CARD, '.download'));
  const failed = await waitForCard(popup, BROKEN_CARD, (view) => view.text.startsWith('Could not save the video.') && !view.downloadDisabled);
  if (!failed?.text.startsWith('Could not save the video.') || !failed.text.includes('The server answered 404.') || failed.downloadDisabled) {
    return [`the broken stream did not end with the failure text: ${JSON.stringify(failed)}`];
  }
  return [];
}

const SAVED_TEXT = 'Saved to your downloads folder.';

/**
 * After the streams of /download.html were saved: every card must have come to "Saved ..." and have its
 * Download button back. Returns what went wrong, or undefined.
 */
export async function savedTextProblem(popup: PopupPage, cards: number): Promise<string | undefined> {
  const views: (JobCardView | undefined)[] = [];
  for (let card = 0; card < cards; card++) {
    views.push(await waitForCard(popup, card, (view) => view.text === SAVED_TEXT && !view.downloadDisabled));
  }

  const wrong = views.filter((view) => view?.text !== SAVED_TEXT || view.downloadDisabled);
  return wrong.length === 0 ? undefined : `a saved stream did not end as "${SAVED_TEXT}": ${JSON.stringify(views)}`;
}
