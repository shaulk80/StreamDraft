import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { concatBytes } from '../../src/engine/mp4/bytes.ts';
import { readMovie, type ReadMovie } from '../engine/flat-mp4-reader.ts';
import { HUGE, LARGE, LARGE_AUDIO_SAMPLE_BYTES, LARGE_VIDEO_SAMPLE_BYTES, largeSampleFill, type StreamProfile } from '../pages/large-stream.ts';
import type { PopupPage } from './job-display.ts';
import { MemorySampler, type MemoryMeasure } from './memory-sampler.ts';

// The large file checks, the same in Firefox and Chrome: a stream of 1.1 GiB (`large`) or 4.5 GiB (`huge`)
// is downloaded through the popup while the memory of the browser is sampled, then the saved file is read
// back. They take minutes and several GB of disk, so the smoke tests run them only when SMOKE_LARGE is
// set: `1` for the 1.1 GiB stream, `huge` for the 4.5 GiB one, `all` for both.

export interface LargeCheck {
  profile: StreamProfile;
  /** The test page that makes the browser fetch the manifest. */
  page: string;
  /** The name of the saved file: the title of the page and the quality. */
  fileName: string;
}

function checkOf(profile: StreamProfile): LargeCheck {
  return { profile, page: `${profile.folder}.html`, fileName: `StreamDraft ${profile.folder} stream test page [720p].mp4` };
}

const MIB = 1024 * 1024;
const POLL_MS = 1000;
/** The temporary files go once the browser reports the file as saved; this is how long that may take. */
const CLEANUP_WAIT_MS = 30_000;
/** What may stay in the extension's storage afterwards (settings and job records are small). */
const LEFTOVER_LIMIT_MIB = 64;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
export const SAVED_TEXT = 'Saved to your downloads folder.';
export const FAILED_TEXT = 'Could not save the video.';
/**
 * The most the memory of the browser may grow, for a file of 1.1 GiB or less. Measured: 256 MiB in
 * Firefox, 370 to 590 MiB in Chrome (a renderer that has not yet collected its garbage), at 0.5 to 2 GiB
 * alike. A join that held the file would grow by at least its 1089 MiB.
 */
const GROWTH_LIMIT_MIB = 768;
/**
 * For a bigger file the limit grows with it, to this share of the file: Chrome's renderer grew 902 MiB
 * (a fifth of the file) on the 4.5 GiB stream, Firefox 85 to 97 MiB. A join that held the file grows by
 * all of it, three times the limit.
 */
const GROWTH_SHARE = 1 / 3;

function growthLimitMib(streamBytes: number): number {
  return Math.max(GROWTH_LIMIT_MIB, Math.round((streamBytes / MIB) * GROWTH_SHARE));
}
/** Room for the boxes around the samples: the `ftyp` at the start and the `moov` at the end. */
const MAX_MOVIE_BYTES = 64 * MIB;
const BOX_HEAD_BYTES = 16;
/** Enough for the `ftyp` and the header of the `mdat` after it. */
const HEAD_READ_BYTES = 256;
const LARGE_SIZE_MARKER = 1;

/** The 1.1 GiB stream, the one the low-disk check starts. */
export const LARGE_CHECK: LargeCheck = checkOf(LARGE);

/** The checks the environment asks for, in the order they run. */
export function selectedLargeChecks(): LargeCheck[] {
  const wanted = process.env['SMOKE_LARGE'];
  if (wanted === 'all') {
    return [checkOf(LARGE), checkOf(HUGE)];
  }
  if (wanted === 'huge') {
    return [checkOf(HUGE)];
  }
  return wanted === '1' ? [checkOf(LARGE)] : [];
}

/** A problem text when the browser's memory grew with the file, otherwise undefined. */
export function memoryProblem(measure: MemoryMeasure, streamBytes: number): string | undefined {
  const limit = growthLimitMib(streamBytes);
  return measure.growthMib <= limit ? undefined : `the memory of the browser grew by ${measure.growthMib} MiB, mostly ${measure.growers} (limit ${limit} MiB for a file of ${Math.round(streamBytes / MIB)} MiB)`;
}

function readAt(fd: number, position: number, length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  const read = readSync(fd, buffer, 0, length, position);
  return read === length ? buffer : buffer.subarray(0, read);
}

/**
 * The `ftyp` and `moov` of the saved file without the `mdat` between them, which may be many GiB: the
 * head tells where the `mdat` ends, the movie box is everything after it. Undefined with a problem text
 * when the file is not laid out as the writer lays it out.
 */
function readMovieOf(fd: number, size: number): ReadMovie | string {
  const head = readAt(fd, 0, HEAD_READ_BYTES);
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const typeSize = view.getUint32(0);
  if (typeSize + BOX_HEAD_BYTES > head.length || view.getUint32(typeSize) !== LARGE_SIZE_MARKER) {
    return 'the file does not start with an ftyp and an mdat with a 64-bit size';
  }

  const mdatEnd = typeSize + Number(view.getBigUint64(typeSize + 8));
  const movieBytes = size - mdatEnd;
  if (movieBytes <= 0 || movieBytes > MAX_MOVIE_BYTES) {
    return `the mdat ends at ${mdatEnd} in a file of ${size} bytes, leaving ${movieBytes} for the movie box`;
  }
  return readMovie(concatBytes([readAt(fd, 0, typeSize), readAt(fd, mdatEnd, movieBytes)]));
}

function sampleProblem(fd: number, movie: ReadMovie): string | undefined {
  const sizes = [LARGE_VIDEO_SAMPLE_BYTES, LARGE_AUDIO_SAMPLE_BYTES];
  for (const [trackIndex, track] of movie.tracks.entries()) {
    for (const [index, sample] of track.samples.entries()) {
      const fill = largeSampleFill(index);
      const first = readAt(fd, sample.offset, 1)[0];
      const last = readAt(fd, sample.offset + sample.size - 1, 1)[0];
      const intact = sample.size === sizes[trackIndex] && first === fill && last === fill;
      if (!intact) {
        return `sample ${index} of track ${trackIndex + 1} is not what was sent (size ${sample.size}, first byte ${first}, last byte ${last}, expected ${fill})`;
      }
    }
  }
  return undefined;
}

/** A problem text when the saved file is not the whole stream as a flat MP4 with every sample intact, otherwise undefined. */
export function largeFileProblem(filePath: string, check: LargeCheck): string | undefined {
  if (!existsSync(filePath)) {
    return `${check.fileName} was not saved`;
  }

  const size = statSync(filePath).size;
  if (size < check.profile.streamBytes) {
    return `${check.fileName} is ${size} bytes, the samples alone are ${check.profile.streamBytes}`;
  }

  const fd = openSync(filePath, 'r');
  try {
    const movie = readMovieOf(fd, size);
    if (typeof movie === 'string') {
      return `${check.fileName}: ${movie}`;
    }

    const counts = movie.tracks.map((track) => track.samples.length);
    if (JSON.stringify(counts) !== JSON.stringify(check.profile.trackSamples)) {
      return `${check.fileName} has tracks of [${counts.join(', ')}] samples, expected [${check.profile.trackSamples.join(', ')}]`;
    }
    return sampleProblem(fd, movie);
  } catch (error) {
    return `${check.fileName} is not a readable MP4: ${String(error)}`;
  } finally {
    closeSync(fd);
  }
}

// The line of the job panel once a job exists (as in job-display.ts), otherwise the card's own line.
const RESULT_TEXT =
  "(() => { const card = document.querySelector('#media-list .card'); const panel = card && card.querySelector('.job'); const line = panel ? panel.querySelector('.result') : card && card.querySelector('.result'); return line ? line.textContent : ''; })()";

/** Waits until the card says it saved or failed; the last text it showed is the answer. */
export async function waitForEnd(popup: PopupPage): Promise<string> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let text = '';
  while (Date.now() < deadline) {
    text = (await popup.read(RESULT_TEXT)) ?? '';
    if (text === SAVED_TEXT || text.startsWith(FAILED_TEXT)) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return `no end after ${JOB_TIMEOUT_MS / 60_000} minutes, the card said "${text}"`;
}

export interface Leftover {
  mib: number | undefined;
  text: string;
}

/** A problem text when more than the settings and job records are left in the extension's storage, otherwise undefined. */
export function leftoverProblem(left: Leftover): string | undefined {
  if (left.mib === undefined || left.mib <= LEFTOVER_LIMIT_MIB) {
    return undefined;
  }
  return `${left.mib} MiB of temporary files were still in the extension's storage ${CLEANUP_WAIT_MS / 1000} s after the job ended`;
}

/** The storage of the extension once the temporary files had time to go: polled, as the browser decides when it is done. */
export async function leftoverStorage(storageUsage: () => Promise<number | undefined>): Promise<Leftover> {
  const started = Date.now();
  let mib: number | undefined;
  do {
    const bytes = await storageUsage();
    mib = bytes === undefined ? undefined : Math.round(bytes / MIB);
    if (mib === undefined || mib <= LEFTOVER_LIMIT_MIB) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  } while (Date.now() - started < CLEANUP_WAIT_MS);

  const seconds = Math.round((Date.now() - started) / 1000);
  return { mib, text: mib === undefined ? 'not read' : `${mib} MiB after ${seconds} s` };
}

/**
 * Presses Download on the one stream of the open popup, samples the memory of the browser until the
 * job ends, then reads the saved file. `storageUsage` gives the OPFS use of the extension afterwards.
 * Logs one line (sizes, time, memory, with the `label` of the browser) and returns what went wrong.
 */
export async function checkLargeDownload(label: string, check: LargeCheck, popup: PopupPage, savedFile: string, storageUsage: () => Promise<number | undefined>): Promise<string[]> {
  const sampler = new MemorySampler();
  await sampler.start();
  const started = Date.now();
  await popup.act("document.querySelector('#media-list .download').click();");
  const end = await waitForEnd(popup);
  const seconds = Math.round((Date.now() - started) / 1000);
  const memory = await sampler.stop();

  const problems: string[] = [];
  if (end !== SAVED_TEXT) {
    problems.push(`the ${check.profile.folder} stream did not end as "${SAVED_TEXT}" after ${seconds} s: ${end}`);
    return problems;
  }

  const memoryText = memoryProblem(memory, check.profile.streamBytes);
  if (memoryText !== undefined) {
    problems.push(memoryText);
  }
  const fileText = largeFileProblem(savedFile, check);
  if (fileText !== undefined) {
    problems.push(fileText);
  }

  const left = await leftoverStorage(storageUsage);
  const leftText = leftoverProblem(left);
  if (leftText !== undefined) {
    problems.push(leftText);
  }
  const savedMib = existsSync(savedFile) ? Math.round(statSync(savedFile).size / MIB) : 0;
  const summary = `${savedMib} MiB saved in ${seconds} s; browser memory ${memory.baselineMib} MiB before, ${memory.peakMib} MiB at the peak (growth ${memory.growthMib} MiB, mostly ${memory.growers}); extension storage left afterwards: ${left.text}`;
  console.log(`${label} runtime: ${check.profile.folder} stream: ${summary}`);
  return problems;
}
