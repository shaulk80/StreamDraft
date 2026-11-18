import { describe, expect, test } from 'vitest';
import { ADDRESS_EXPIRED, NETWORK_FAILED } from '../../src/core/failures.ts';
import type { JobState } from '../../src/engine/job-state.ts';
import { describeJob } from '../../src/ui/job-description.ts';

const BASE: JobState = {
  id: 'job-1',
  itemId: 'https://example.com/a.m3u8',
  title: 'A video',
  status: 'running',
  doneSegments: 0,
  totalSegments: 0,
  bytes: 0,
  updatedAt: 1,
};

describe('describeJob', () => {
  test.each<[string, Partial<JobState>, { text: string; fraction: number | undefined; finished: boolean; failed: boolean; canCancel: boolean; canRetry: boolean }]>([
    ['a job that has not counted its parts yet', {}, { text: 'Starting...', fraction: undefined, finished: false, failed: false, canCancel: true, canRetry: false }],
    [
      'a job fetching parts',
      { doneSegments: 45, totalSegments: 100, bytes: 12_582_912 },
      { text: 'Downloading: 45% (12 MB)', fraction: 0.45, finished: false, failed: false, canCancel: true, canRetry: false },
    ],
    [
      'a job fetching its first part',
      { doneSegments: 0, totalSegments: 100 },
      { text: 'Downloading: 0%', fraction: 0, finished: false, failed: false, canCancel: true, canRetry: false },
    ],
    [
      'a job that has all parts and is joining them',
      { doneSegments: 100, totalSegments: 100, bytes: 5000 },
      { text: 'Joining the parts and saving...', fraction: undefined, finished: false, failed: false, canCancel: false, canRetry: false },
    ],
    [
      'a finished job',
      { status: 'done', doneSegments: 100, totalSegments: 100 },
      { text: 'Saved to your downloads folder.', fraction: 1, finished: true, failed: false, canCancel: false, canRetry: false },
    ],
    [
      'a cancelled job',
      { status: 'cancelled', doneSegments: 10, totalSegments: 100 },
      { text: 'Cancelled.', fraction: undefined, finished: true, failed: false, canCancel: false, canRetry: false },
    ],
    [
      'a failed job with a reason',
      { status: 'failed', error: ADDRESS_EXPIRED },
      { text: `Could not save the video. ${ADDRESS_EXPIRED}`, fraction: undefined, finished: true, failed: true, canCancel: false, canRetry: false },
    ],
    [
      'a failed job that a new try can fix',
      { status: 'failed', error: NETWORK_FAILED },
      { text: `Could not save the video. ${NETWORK_FAILED}`, fraction: undefined, finished: true, failed: true, canCancel: false, canRetry: true },
    ],
    [
      'a failed job without a reason',
      { status: 'failed' },
      { text: 'Could not save the video.', fraction: undefined, finished: true, failed: true, canCancel: false, canRetry: false },
    ],
  ])('%s', (_name, changes, expected) => {
    expect(describeJob({ ...BASE, ...changes })).toEqual(expected);
  });
});
