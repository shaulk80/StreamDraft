import type { CaptureSnapshot } from '../extractors/capture/types.ts';
import type { Result } from '../core/result.ts';
import type { CaptureClient } from './capture-client.ts';
import { describeCapture, type CaptureDescription } from './capture-description.ts';
import { createElement } from './dom.ts';
import { createJobPanel } from './job-panel.ts';
import type { JobsView } from './job-tracker.ts';

/** How often the popup asks the page how the recording stands while it is open. */
export const CAPTURE_POLL_MS = 1000;

const HINT = 'Reloads the page and records the video while it plays. The saved file is as long as what you let play.';
const WAITING = describeCapture({ protected: false, buffers: [], missing: [], problems: [], complete: false });

export interface CapturePanelDeps {
  client: CaptureClient;
  jobs: JobsView;
  /** The id of the item that a save of this tab's recording runs under, to find a job again when the popup was closed. */
  itemId: string;
  /** Calls `callback` every `milliseconds` until the returned function is called. */
  every(callback: () => void, milliseconds: number): () => void;
}

export interface CapturePanel {
  element: HTMLElement;
  /** Reads where the page's recording stands, shows it, and keeps it up to date. */
  start(): Promise<void>;
}

/** The "Record this page" section of the popup: Record, progress, Save, Cancel and the job of a save. */
export function createCapturePanel(doc: Document, deps: CapturePanelDeps): CapturePanel {
  const element = createElement(doc, 'section', 'capture');
  const heading = createElement(doc, 'h2', 'title', 'Record this page');
  const hint = createElement(doc, 'p', 'meta', HINT);
  const record = createElement(doc, 'button', 'download', 'Record');
  record.type = 'button';
  const bar = createElement(doc, 'progress', 'job-bar');
  bar.max = 1;
  const text = createElement(doc, 'p', 'result');
  text.setAttribute('role', 'status');
  const note = createElement(doc, 'p', 'notice');
  const save = createElement(doc, 'button', 'download', 'Save');
  const saveSound = createElement(doc, 'button', 'download', 'Save audio only');
  const cancel = createElement(doc, 'button', 'cancel', 'Cancel recording');
  for (const button of [save, saveSound, cancel]) {
    button.type = 'button';
  }
  const actions = createElement(doc, 'div', 'actions');
  actions.append(save, saveSound, cancel);
  const message = createElement(doc, 'p', 'result');
  message.setAttribute('role', 'status');
  const jobArea = createElement(doc, 'div');
  element.append(heading, hint, record, bar, text, note, actions, message, jobArea);

  /** The tab was armed by this popup and the page may still be loading, so a missing answer is not an error yet. */
  let reloading = false;
  /** A save is running: the buttons wait for it. */
  let saving = false;
  let latest: CaptureDescription = describeCapture(undefined);

  const showMessage = (words: string, isError: boolean): void => {
    message.textContent = words;
    message.classList.toggle('error', isError);
  };

  const draw = (description: CaptureDescription): void => {
    latest = description;
    const idle = description.phase === 'idle';
    const failed = description.phase === 'problem';
    const noticeText = description.note ?? '';
    hint.hidden = !idle;
    record.hidden = !idle && !failed;
    record.textContent = failed ? 'Record again' : 'Record';
    text.hidden = idle;
    text.textContent = description.text;
    text.classList.toggle('error', failed);
    bar.hidden = idle || failed || description.phase === 'waiting';
    if (description.fraction === undefined) {
      bar.removeAttribute('value');
    } else {
      bar.value = description.fraction;
    }
    note.hidden = noticeText === '';
    note.textContent = noticeText;
    actions.hidden = idle;
    save.disabled = !description.canSave || saving;
    saveSound.disabled = !description.canSave || saving;
  };

  const show = (status: Result<CaptureSnapshot>): void => {
    const snapshot = status.ok ? status.value : undefined;
    if (snapshot !== undefined && (snapshot.buffers.length > 0 || snapshot.protected)) {
      reloading = false;
      draw(describeCapture(snapshot));
      return;
    }
    // Nothing recorded yet: an armed page waits for its player, any other page offers Record.
    draw(reloading ? WAITING : describeCapture(undefined));
  };

  const refresh = async (): Promise<void> => {
    show(await deps.client.status());
  };

  /** Shows the progress of the save under the buttons; they wait until the job ends. */
  const follow = (jobId: string): void => {
    jobArea.replaceChildren();
    saving = true;
    draw(latest);
    const requestCancel = async (): Promise<boolean> => {
      const asked = await deps.jobs.cancel(jobId);
      if (!asked.ok) {
        showMessage(asked.error, true);
      }
      return asked.ok;
    };
    const panel = createJobPanel(doc, requestCancel);
    jobArea.append(panel.element);
    deps.jobs.watch(jobId, (state) => {
      if (panel.show(state)) {
        saving = false;
        draw(latest);
      }
    });
  };

  const saveRecording = async (soundOnly: boolean): Promise<void> => {
    saving = true;
    draw(latest);
    showMessage('', false);
    const started = await deps.client.save(soundOnly);
    if (!started.ok) {
      saving = false;
      draw(latest);
      showMessage(started.error, true);
      return;
    }
    follow(started.value.jobId);
  };

  record.addEventListener('click', () => {
    record.disabled = true;
    showMessage('', false);
    void deps.client.arm().then((armed) => {
      record.disabled = false;
      if (!armed.ok) {
        showMessage(armed.error, true);
        return;
      }
      reloading = true;
      jobArea.replaceChildren();
      draw(WAITING);
    });
  });
  save.addEventListener('click', () => void saveRecording(false));
  saveSound.addEventListener('click', () => void saveRecording(true));
  cancel.addEventListener('click', () => {
    cancel.disabled = true;
    void deps.client.discard().then((discarded) => {
      cancel.disabled = false;
      if (!discarded.ok) {
        showMessage(discarded.error, true);
        return;
      }
      reloading = false;
      showMessage('The recording was removed.', false);
      draw(describeCapture(undefined));
    });
  });

  return {
    element,
    async start() {
      draw(describeCapture(undefined));
      await refresh();
      // The popup was closed while a save ran: pick the job up again, so it can be watched and stopped.
      const running = deps.jobs.runningFor(deps.itemId);
      if (running !== undefined) {
        follow(running.id);
      }
      deps.every(() => void refresh(), CAPTURE_POLL_MS);
    },
  };
}
