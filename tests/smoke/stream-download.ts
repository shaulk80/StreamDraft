import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readFlatMp4 } from '../engine/flat-mp4-reader.ts';
import { ffprobeProblem } from './ffprobe.ts';

// What the stream download checks of both browsers share: the page, the names the files
// are saved under, and a look inside the saved files.

export const STREAM_PAGE = 'download.html';
export const STREAM_PAGE_TITLE = 'StreamDraft stream download test page';

/** The DASH stream (a 360p picture and a sound) and the HLS stream (one playlist, no quality named) as saved. */
export const DASH_FILE_NAME = `${STREAM_PAGE_TITLE} [360p].mp4`;
export const HLS_FILE_NAME = `${STREAM_PAGE_TITLE} [original].mp4`;

/** The streams ffprobe must find in a file with picture and sound, and in one with sound only. */
const PICTURE_AND_SOUND = ['video', 'audio'];
const SOUND_ONLY = ['audio'];

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
  if (JSON.stringify(saved.samplesPerTrack) !== JSON.stringify(DASH_TRACKS)) {
    return `${DASH_FILE_NAME} has tracks of [${saved.samplesPerTrack.join(', ')}] samples, expected [${DASH_TRACKS.join(', ')}]`;
  }

  return ffprobeProblem(filePath, PICTURE_AND_SOUND);
}

/** A problem text when the saved HLS file has no video and sound samples, otherwise undefined. */
export function hlsFileProblem(filePath: string): string | undefined {
  const saved = readSavedStream(filePath);
  if (!saved.ok) {
    return `${HLS_FILE_NAME} is not a readable MP4: ${saved.error}`;
  }
  if (saved.samplesPerTrack.length === 0 || saved.samplesPerTrack.some((count) => count === 0)) {
    return `${HLS_FILE_NAME} has tracks of [${saved.samplesPerTrack.join(', ')}] samples`;
  }

  return ffprobeProblem(filePath, PICTURE_AND_SOUND);
}

/**
 * Picks "Audio only" on one stream card of the popup and presses Download; a statement list, wrap it
 * where an expression is needed. The cards are saved one at a time: both files have the same name, and
 * two downloads of one name started in the same instant can make the browser interrupt one of them.
 */
export function saveSoundScript(cardIndex: number): string {
  return `const card = document.querySelectorAll('#media-list .card')[${cardIndex}]; const picker = card.querySelector('select.quality'); picker.value = 'audio'; card.querySelector('.download').click();`;
}

/** Both streams have the same title and the same quality name, so the browser numbers the second file: the names are matched by their start and end. */
const AUDIO_FILE_START = `${STREAM_PAGE_TITLE} [audio]`;
export const AUDIO_FILE_COUNT = 2;
/** The sound of the DASH stream is 4 samples of one track. */
const DASH_AUDIO_SAMPLES = 4;

export function audioFileNames(folderNames: readonly string[]): string[] {
  return folderNames.filter((name) => name.startsWith(AUDIO_FILE_START) && name.endsWith('.m4a')).sort();
}

/**
 * A problem text when the saved sound files are not two files of one sound track each (the DASH one
 * with its 4 samples, the other cut out of the HLS stream's video), otherwise undefined.
 */
export function audioFilesProblem(folder: string, names: readonly string[]): string | undefined {
  const saved = names.map((name) => ({ name, content: readSavedStream(path.join(folder, name)) }));
  for (const { name, content } of saved) {
    if (!content.ok) {
      return `${name} is not a readable MP4: ${content.error}`;
    }
    if (content.samplesPerTrack.length !== 1 || (content.samplesPerTrack[0] ?? 0) === 0) {
      return `${name} has tracks of [${content.samplesPerTrack.join(', ')}] samples, expected one track with sound`;
    }

    const outside = ffprobeProblem(path.join(folder, name), SOUND_ONLY);
    if (outside !== undefined) {
      return `${name}: ${outside}`;
    }
  }

  const dashSound = saved.some(({ content }) => content.ok && content.samplesPerTrack[0] === DASH_AUDIO_SAMPLES);
  return dashSound ? undefined : `none of [${names.join(', ')}] is the DASH sound of ${DASH_AUDIO_SAMPLES} samples`;
}
