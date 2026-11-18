import { describe, expect, test } from 'vitest';
import {
  ADDRESS_EXPIRED,
  DISK_FULL,
  httpFailure,
  isRetryable,
  NAME_TOO_LONG,
  NETWORK_FAILED,
  NOT_SAVED,
  PAGE_GONE,
  PART_GONE,
  SAVE_DENIED,
  SAVE_NO_SPACE,
  saveFailure,
  SERVER_BUSY,
} from '../../src/core/failures.ts';

describe('httpFailure', () => {
  test.each<[string, number, string]>([
    ['unauthorized', 401, ADDRESS_EXPIRED],
    ['forbidden', 403, ADDRESS_EXPIRED],
    ['not found', 404, PART_GONE],
    ['gone', 410, PART_GONE],
    ['too many requests', 429, SERVER_BUSY],
    ['request timeout', 408, SERVER_BUSY],
    ['server error', 500, SERVER_BUSY],
    ['unavailable', 503, SERVER_BUSY],
    ['anything else', 418, 'The video server answered 418, which StreamDraft cannot use.'],
  ])('%s (%i)', (_name, status, message) => {
    expect(httpFailure(status)).toBe(message);
  });
});

describe('saveFailure', () => {
  test.each<[string, string | undefined, string]>([
    ['no room on the disk', 'FILE_NO_SPACE', SAVE_NO_SPACE],
    ['a folder that cannot be written', 'FILE_ACCESS_DENIED', SAVE_DENIED],
    ['a file name that is too long', 'FILE_NAME_TOO_LONG', NAME_TOO_LONG],
    ['another reason', 'FILE_FAILED', NOT_SAVED],
    ['no reason', undefined, NOT_SAVED],
  ])('%s', (_name, reason, message) => {
    expect(saveFailure(reason)).toBe(message);
  });
});

describe('isRetryable', () => {
  test.each<[string, string | undefined, boolean]>([
    ['a lost connection', NETWORK_FAILED, true],
    ['a busy server', SERVER_BUSY, true],
    ['a full disk', DISK_FULL, true],
    ['no room to save the file', SAVE_NO_SPACE, true],
    ['an address that expired', ADDRESS_EXPIRED, false],
    ['a part the server no longer has', PART_GONE, false],
    ['a page that was closed', PAGE_GONE, false],
    ['a protected video', 'This video is protected by DRM and cannot be downloaded.', false],
    ['no message', undefined, false],
  ])('%s', (_name, message, retryable) => {
    expect(isRetryable(message)).toBe(retryable);
  });
});
