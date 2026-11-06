import { downloadFilename, formatSize, pickQuality, type MediaItem, type QualityOption } from '../core/media.ts';
import type { Settings } from '../core/settings.ts';

const KIND_LABELS = { direct: 'Direct file', hls: 'HLS stream', dash: 'DASH stream' } as const;

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

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

function createProtectedNotice(doc: Document): HTMLElement {
  return createElement(
    doc,
    'p',
    'notice',
    'Protected by DRM. StreamDraft does not download protected videos.',
  );
}

export function createDownloadRow(doc: Document, item: MediaItem, settings: Settings): HTMLElement {
  const row = createElement(doc, 'div', 'actions');
  const picker = createQualityPicker(doc, item, settings.defaultQuality);
  const button = createElement(doc, 'button', 'download', 'Download');
  button.type = 'button';
  const result = createElement(doc, 'p', 'result');
  result.setAttribute('role', 'status');

  button.addEventListener('click', () => {
    const option = item.qualities.find((candidate) => candidate.quality === picker.value);
    if (!option) {
      result.textContent = 'Pick a quality first.';
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const name = downloadFilename(item, option, settings.filenameTemplate, date);
    // M1 only: nothing is downloaded yet. M2 replaces this with the downloads API.
    result.textContent = `Demo only. Would save as "${name}".`;
  });

  row.append(picker, button);
  const wrapper = createElement(doc, 'div');
  wrapper.append(row, result);
  return wrapper;
}

function createCard(doc: Document, item: MediaItem, settings: Settings): HTMLElement {
  const card = createElement(doc, 'li', 'card');
  card.append(
    createElement(doc, 'h2', 'title', item.title),
    createElement(doc, 'p', 'meta', `${item.site} · ${KIND_LABELS[item.kind]} · ${item.container}`),
  );

  if (item.protected) {
    card.append(createProtectedNotice(doc));
    return card;
  }

  card.append(createDownloadRow(doc, item, settings));
  return card;
}

/** Fills the list with one card per video, or shows `emptyNotice` when there are none. */
export function renderMediaList(
  list: HTMLElement,
  emptyNotice: HTMLElement,
  items: readonly MediaItem[],
  settings: Settings,
): void {
  const doc = list.ownerDocument;
  list.replaceChildren(...items.map((item) => createCard(doc, item, settings)));
  emptyNotice.hidden = items.length > 0;
}
