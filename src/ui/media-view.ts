import { formatSize, needsManifest, pickQuality, type MediaItem, type QualityOption } from '../core/media.ts';
import type { Settings } from '../core/settings.ts';
import { fileNameOfAddress } from '../core/url-names.ts';
import type { DownloadAction } from './download-client.ts';
import { createElement } from './dom.ts';
import { createJobPanel } from './job-panel.ts';
import type { JobsView } from './job-tracker.ts';

const KIND_LABELS = { direct: 'Direct file', hls: 'HLS stream', dash: 'DASH stream', capture: 'Recording' } as const;

function qualityLabel(option: QualityOption): string {
  if (option.sizeBytes === undefined) {
    return option.label;
  }
  return `${option.label} (${formatSize(option.sizeBytes)})`;
}

function createQualityPicker(doc: Document, item: MediaItem, wanted: Settings['defaultQuality']): HTMLSelectElement {
  const select = createElement(doc, 'select', 'quality');
  select.setAttribute('aria-label', `Quality for ${item.title}`);

  for (const option of item.qualities) {
    const choice = createElement(doc, 'option', undefined, qualityLabel(option));
    choice.value = option.quality;
    select.append(choice);
  }

  const preselected = pickQuality(item, wanted);
  if (preselected) {
    select.value = preselected.quality;
  }
  return select;
}

const READING_TEXT = 'Reading the stream...';

/** What to say under a protected video: what protects it, when the manifest says. */
export function protectedText(item: MediaItem): string {
  const reason = item.protectedReason === undefined ? 'DRM' : item.protectedReason;
  return `Protected (${reason}). StreamDraft does not download protected videos.`;
}

/** The line that takes the place of the download row, or undefined when the video can be downloaded. */
export function noticeText(item: MediaItem): string | undefined {
  if (item.protected) {
    return protectedText(item);
  }
  if (!needsManifest(item)) {
    return undefined;
  }
  return item.manifestError ?? READING_TEXT;
}

/**
 * Changes whenever the list needs drawing again: a video came, or a stream's
 * manifest was read. Redrawing resets a quality choice, so nothing else counts.
 */
export function listSignature(items: readonly MediaItem[]): string {
  return items
    .map((item) => [item.id, item.qualities.length, item.protected, item.manifestError ?? ''].join('|'))
    .join('\n');
}

export function createDownloadRow(
  doc: Document,
  item: MediaItem,
  settings: Settings,
  download: DownloadAction,
  jobs?: JobsView,
): HTMLElement {
  const row = createElement(doc, 'div', 'actions');
  const picker = createQualityPicker(doc, item, settings.defaultQuality);
  const button = createElement(doc, 'button', 'download', 'Download');
  button.type = 'button';
  const result = createElement(doc, 'p', 'result');
  result.setAttribute('role', 'status');
  const wrapper = createElement(doc, 'div');
  wrapper.append(row, result);
  let panel: HTMLElement | undefined;

  const showResult = (text: string, isError: boolean): void => {
    result.textContent = text;
    result.classList.toggle('error', isError);
  };

  /** Shows the progress of a stream job under the button, which waits until the job ends. */
  const follow = (tracker: JobsView, jobId: string): void => {
    panel?.remove();
    showResult('', false);
    button.disabled = true;

    const requestCancel = async (): Promise<boolean> => {
      const asked = await tracker.cancel(jobId);
      if (!asked.ok) {
        showResult(asked.error, true);
      }
      return asked.ok;
    };
    const jobPanel = createJobPanel(doc, requestCancel);
    panel = jobPanel.element;
    wrapper.append(panel);

    tracker.watch(jobId, (state) => {
      if (jobPanel.show(state)) {
        button.disabled = false;
      }
    });
  };

  button.addEventListener('click', () => {
    const option = item.qualities.find((candidate) => candidate.quality === picker.value);
    if (!option) {
      showResult('Pick a quality first.', true);
      return;
    }

    // A second click while the browser is starting the download would start it twice.
    button.disabled = true;
    showResult('', false);
    void download(item, option).then((outcome) => {
      if (outcome.ok && outcome.value.jobId !== undefined && jobs !== undefined) {
        follow(jobs, outcome.value.jobId);
        return;
      }
      showResult(outcome.ok ? outcome.value.text : outcome.error, !outcome.ok);
      button.disabled = false;
    });
  });

  row.append(picker, button);

  // The popup was closed while a job ran: pick it up again, so it can be watched and stopped.
  const running = jobs?.runningFor(item.id);
  if (jobs !== undefined && running !== undefined) {
    follow(jobs, running.id);
  }
  return wrapper;
}

/**
 * The line under the title. A direct file shows its file name: a page often
 * has several videos with the same page title, and the name tells them apart.
 */
export function metaText(item: MediaItem): string {
  const details = [item.site, KIND_LABELS[item.kind]];
  const fileName = item.kind === 'direct' ? fileNameOfAddress(item.url) : '';
  details.push(fileName === '' ? item.container : fileName);
  return details.join(' · ');
}

function createCard(doc: Document, item: MediaItem, settings: Settings, download: DownloadAction, jobs?: JobsView): HTMLElement {
  const card = createElement(doc, 'li', 'card');
  card.append(createElement(doc, 'h2', 'title', item.title), createElement(doc, 'p', 'meta', metaText(item)));

  const notice = noticeText(item);
  if (notice !== undefined) {
    card.append(createElement(doc, 'p', 'notice', notice));
    return card;
  }

  card.append(createDownloadRow(doc, item, settings, download, jobs));
  return card;
}

/** Fills the list with one card per video, or shows `emptyNotice` when there are none. */
export function renderMediaList(
  list: HTMLElement,
  emptyNotice: HTMLElement,
  items: readonly MediaItem[],
  settings: Settings,
  download: DownloadAction,
  jobs?: JobsView,
): void {
  const doc = list.ownerDocument;
  list.replaceChildren(...items.map((item) => createCard(doc, item, settings, download, jobs)));
  emptyNotice.hidden = items.length > 0;
}
