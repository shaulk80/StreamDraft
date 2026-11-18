import { createElement } from './dom.ts';
import { describeJob, STARTING, type JobDescription } from './job-description.ts';
import type { JobState } from '../engine/job-state.ts';

/** The progress bar, text and Cancel button under a stream's Download button. */
export interface JobPanel {
  element: HTMLElement;
  /** Draws the state; returns true once the job has ended. */
  show(state: JobState): boolean;
}

/**
 * `requestCancel` asks the background to stop the job and resolves with whether
 * it could; the button is given back for another try when it could not.
 * `retry` starts the same download again; without it the panel never offers "Try again".
 */
export function createJobPanel(doc: Document, requestCancel: () => Promise<boolean>, retry?: () => void): JobPanel {
  const element = createElement(doc, 'div', 'job');
  const bar = createElement(doc, 'progress', 'job-bar');
  bar.max = 1;
  const text = createElement(doc, 'p', 'result');
  text.setAttribute('role', 'status');
  const cancel = createElement(doc, 'button', 'cancel', 'Cancel');
  cancel.type = 'button';
  const again = createElement(doc, 'button', 'retry', 'Try again');
  again.type = 'button';
  const line = createElement(doc, 'div', 'job-line');
  line.append(text, cancel, again);
  element.append(bar, line);

  cancel.addEventListener('click', () => {
    // A second click would ask twice.
    cancel.disabled = true;
    void requestCancel().then((asked) => {
      cancel.disabled = asked;
    });
  });

  again.addEventListener('click', () => {
    // The caller replaces this panel with the new job's; a second click would start it twice.
    again.disabled = true;
    retry?.();
  });

  const draw = (description: JobDescription): boolean => {
    text.textContent = description.text;
    text.classList.toggle('error', description.failed);
    cancel.hidden = !description.canCancel;
    again.hidden = !description.canRetry || retry === undefined;
    // A bar without a value is the browser's "busy" bar.
    if (description.fraction === undefined) {
      bar.removeAttribute('value');
    } else {
      bar.value = description.fraction;
    }
    bar.hidden = description.finished && description.fraction === undefined;
    return description.finished;
  };

  draw(STARTING);
  return { element, show: (state) => draw(describeJob(state)) };
}
