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
 */
export function createJobPanel(doc: Document, requestCancel: () => Promise<boolean>): JobPanel {
  const element = createElement(doc, 'div', 'job');
  const bar = createElement(doc, 'progress', 'job-bar');
  bar.max = 1;
  const text = createElement(doc, 'p', 'result');
  text.setAttribute('role', 'status');
  const cancel = createElement(doc, 'button', 'cancel', 'Cancel');
  cancel.type = 'button';
  const line = createElement(doc, 'div', 'job-line');
  line.append(text, cancel);
  element.append(bar, line);

  cancel.addEventListener('click', () => {
    // A second click would ask twice.
    cancel.disabled = true;
    void requestCancel().then((asked) => {
      cancel.disabled = asked;
    });
  });

  const draw = (description: JobDescription): boolean => {
    text.textContent = description.text;
    text.classList.toggle('error', description.failed);
    cancel.hidden = !description.canCancel;
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
