import { fail, ok, type Result } from '../../core/result.ts';
import type { CaptureEvent } from './types.ts';

/** The channel of the `window.postMessage` messages from the page-world hook to the content script. */
export const CAPTURE_CHANNEL = 'streamdraft:capture';

/** A message from the page: nothing in it is believed until it has been read. */
export interface CapturePost {
  channel: typeof CAPTURE_CHANNEL;
  event: CaptureEvent;
}

/** The message that carries `event`; for an `append`, the bytes are the buffer to transfer with it. */
export function capturePost(event: CaptureEvent): { message: CapturePost; transfer: ArrayBuffer[] } {
  if (event.kind === 'append') {
    const copy = event.bytes.buffer.slice(event.bytes.byteOffset, event.bytes.byteOffset + event.bytes.byteLength) as ArrayBuffer;
    return {
      message: { channel: CAPTURE_CHANNEL, event: { ...event, bytes: new Uint8Array(copy) } },
      transfer: [copy],
    };
  }
  return { message: { channel: CAPTURE_CHANNEL, event }, transfer: [] };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** The event inside a `message` event's data, or an error when the data is something else or malformed. */
export function parseCapturePost(data: unknown): Result<CaptureEvent> {
  if (typeof data !== 'object' || data === null) {
    return fail('Not a capture message.');
  }

  const { channel, event } = data as { channel?: unknown; event?: unknown };
  if (channel !== CAPTURE_CHANNEL || typeof event !== 'object' || event === null) {
    return fail('Not a capture message.');
  }

  const fields = event as Record<string, unknown>;
  switch (fields['kind']) {
    case 'buffer':
      return isCount(fields['bufferId']) && isCount(fields['sourceId']) && typeof fields['mime'] === 'string'
        ? ok({ kind: 'buffer', bufferId: fields['bufferId'], sourceId: fields['sourceId'], mime: fields['mime'] })
        : fail('Malformed buffer message.');
    case 'append': {
      const { bufferId, bytes, durationSeconds } = fields;
      if (!isCount(bufferId) || !ArrayBuffer.isView(bytes)) {
        return fail('Malformed append message.');
      }
      // A copy in our own memory: the data comes from the page's world, and Firefox does not let a content
      // script call methods such as `slice` on it ("Permission denied to access property constructor").
      const own = new Uint8Array(bytes.byteLength);
      own.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      return ok({ kind: 'append', bufferId, bytes: own, durationSeconds: typeof durationSeconds === 'number' ? durationSeconds : undefined });
    }
    case 'eme':
      return typeof fields['api'] === 'string' ? ok({ kind: 'eme', api: fields['api'] }) : fail('Malformed encrypted media message.');
    default:
      return fail('Unknown capture message.');
  }
}
