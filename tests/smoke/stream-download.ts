import { readFileSync } from 'node:fs';
import { readFlatMp4 } from '../engine/flat-mp4-reader.ts';

// What the stream download checks of both browsers share: the page, the names the files
// are saved under, and a look inside the saved files.

export const STREAM_PAGE = 'download.html';
export const STREAM_PAGE_TITLE = 'StreamDraft stream download test page';

/** The DASH stream (a 360p picture and a sound) and the HLS stream (one playlist, no quality named) as saved. */
export const DASH_FILE_NAME = `${STREAM_PAGE_TITLE} [360p].mp4`;
export const HLS_FILE_NAME = `${STREAM_PAGE_TITLE} [original].mp4`;

/** The DASH file joins a picture of 4 samples and a sound of 4 samples. */
export const DASH_TRACKS = [4, 4];

/**
 * What the saved file holds: the number of samples of each track, or the reason
 * it is not a flat MP4 (the reader throws on a damaged file, which is the answer here).
 */
export function readSavedStream(filePath: string): { ok: true; samplesPerTrack: number[] } | { ok: false; error: string } {
  try {
    const file = readFlatMp4(readFileSync(filePath));
    return { ok: true, samplesPerTrack: file.tracks.map((track) => track.samples.length) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/** A problem text when the saved DASH file is not the two joined tracks, otherwise undefined. */
export function dashFileProblem(filePath: string): string | undefined {
  const saved = readSavedStream(filePath);
  if (!saved.ok) {
    return `${DASH_FILE_NAME} is not a readable MP4: ${saved.error}`;
  }
  return JSON.stringify(saved.samplesPerTrack) === JSON.stringify(DASH_TRACKS) ? undefined : `${DASH_FILE_NAME} has tracks of [${saved.samplesPerTrack.join(', ')}] samples, expected [${DASH_TRACKS.join(', ')}]`;
}

/** A problem text when the saved HLS file has no video and sound samples, otherwise undefined. */
export function hlsFileProblem(filePath: string): string | undefined {
  const saved = readSavedStream(filePath);
  if (!saved.ok) {
    return `${HLS_FILE_NAME} is not a readable MP4: ${saved.error}`;
  }
  return saved.samplesPerTrack.length > 0 && saved.samplesPerTrack.every((count) => count > 0) ? undefined : `${HLS_FILE_NAME} has tracks of [${saved.samplesPerTrack.join(', ')}] samples`;
}
