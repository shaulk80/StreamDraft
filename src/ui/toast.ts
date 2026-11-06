/** Id of the element that holds the toast; tests look for it. */
export const TOAST_HOST_ID = 'streamdraft-toast';

const TOAST_DURATION_MS = 5000;

const STYLE = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
.toast { max-width: 320px; padding: 10px 14px; border-radius: 6px; background: rgba(20, 20, 20, 0.92);
  color: #fff; font: 13px system-ui, sans-serif; overflow-wrap: anywhere; }
`;

/**
 * Shows a short message in the corner of the page, in a Shadow DOM so the page's
 * styles do not touch it. A newer message replaces an older one. Returns a
 * function that removes the toast early.
 */
export function showToast(doc: Document, text: string): () => void {
  doc.getElementById(TOAST_HOST_ID)?.remove();

  const host = doc.createElement('div');
  host.id = TOAST_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = STYLE;
  const message = doc.createElement('div');
  message.className = 'toast';
  message.setAttribute('role', 'status');
  message.textContent = text;
  shadow.append(style, message);

  doc.body.append(host);
  const timer = globalThis.setTimeout(() => host.remove(), TOAST_DURATION_MS);

  return () => {
    globalThis.clearTimeout(timer);
    host.remove();
  };
}
