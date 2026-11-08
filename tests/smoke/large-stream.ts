import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFlatMp4, type ReadFile } from '../engine/flat-mp4-reader.ts';
import { LARGE_AUDIO_SAMPLE_BYTES, LARGE_STREAM_BYTES, LARGE_TRACK_SAMPLES, LARGE_VIDEO_SAMPLE_BYTES, largeSampleFill } from '../pages/large-stream.ts';
import type { PopupPage } from './job-display.ts';
import { MemorySampler, type MemoryMeasure } from './memory-sampler.ts';

// The large file check, the same in Firefox and Chrome: a stream of 1.1 GiB is downloaded through the
// popup while the memory of the browser is sampled, then the saved file is read back. It takes minutes
// and a few GB of disk, so the smoke tests run it only when SMOKE_LARGE=1 is set.

export const LARGE_PAGE = 'large.html';
export const LARGE_FILE_NAME = 'StreamDraft large stream test page [720p].mp4';

const MIB = 1024 * 1024;
const POLL_MS = 1000;
/** The temporary files go once the browser reports the file as saved; this is how long that may take. */
const CLEANUP_WAIT_MS = 30_000;
/** What may stay in the extension's storage afterwards (settings and job records are small). */
const LEFTOVER_LIMIT_MIB = 64;
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const SAVED_TEXT = 'Saved to your downloads folder.';
const FAILED_TEXT = 'Could not save the video.';
/**
 * The most the memory of the browser may grow. Measured: 256 MiB in Firefox, 370 to 590 MiB in Chrome
 * (a renderer that has not yet collected its garbage), at 0.5 to 2 GiB alike, so it does not follow the
 * size of the file. A join that held the file would grow by at least its 1089 MiB.
 */
const GROWTH_LIMIT_MIB = 768;

export function largeCheckEnabled(): boolean {
  return process.env['SMOKE_LARGE'] === '1';
}

/** A problem text when the browser's memory grew with the file, otherwise undefined. */
export function memoryProblem(measure: MemoryMeasure): string | undefined {
  return measure.growthMib <= GROWTH_LIMIT_MIB ? undefined : `the memory of the browser grew by ${measure.growthMib} MiB, mostly ${measure.growers} (limit ${GROWTH_LIMIT_MIB} MiB for a file of ${Math.round(LARGE_STREAM_BYTES / MIB)} MiB)`;
}

function sampleProblem(file: ReadFile, data: Uint8Array): string | undefined {
  const sizes = [LARGE_VIDEO_SAMPLE_BYTES, LARGE_AUDIO_SAMPLE_BYTES];
  for (const [trackIndex, track] of file.tracks.entries()) {
    for (const [index, sample] of track.samples.entries()) {
      const fill = largeSampleFill(index);
      const intact = sample.size === sizes[trackIndex] && data[sample.offset] === fill && data[sample.offset + sample.size - 1] === fill;
      if (!intact) {
        return `sample ${index} of track ${trackIndex + 1} is not what was sent (size ${sample.size}, first byte ${data[sample.offset]}, expected ${fill})`;
      }
    }
  }
  return undefined;
}

/** A problem text when the saved file is not the whole stream as a flat MP4 with every sample intact, otherwise undefined. */
export function largeFileProblem(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return `${LARGE_FILE_NAME} was not saved`;
  }

  const size = statSync(filePath).size;
  if (size < LARGE_STREAM_BYTES) {
    return `${LARGE_FILE_NAME} is ${size} bytes, the samples alone are ${LARGE_STREAM_BYTES}`;
  }

  try {
    const data = readFileSync(filePath);
    const file = readFlatMp4(data);
    const counts = file.tracks.map((track) => track.samples.length);
    if (JSON.stringify(counts) !== JSON.stringify(LARGE_TRACK_SAMPLES)) {
      return `${LARGE_FILE_NAME} has tracks of [${counts.join(', ')}] samples, expected [${LARGE_TRACK_SAMPLES.join(', ')}]`;
    }
    return sampleProblem(file, data);
  } catch (error) {
    return `${LARGE_FILE_NAME} is not a readable MP4: ${String(error)}`;
  }
}

// The line of the job panel once a job exists (as in job-display.ts), otherwise the card's own line.
const RESULT_TEXT =
  "(() => { const card = document.querySelector('#media-list .card'); const panel = card && card.querySelector('.job'); const line = panel ? panel.querySelector('.result') : card && card.querySelector('.result'); return line ? line.textContent : ''; })()";

/** Waits until the card says it saved or failed; the last text it showed is the answer. */
async function waitForEnd(popup: PopupPage): Promise<string> {
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

interface Leftover {
  mib: number | undefined;
  text: string;
}

/** The storage of the extension once the temporary files had time to go: polled, as the browser decides when it is done. */
async function leftoverStorage(storageUsage: () => Promise<number | undefined>): Promise<Leftover> {
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
export async function checkLargeDownload(label: string, popup: PopupPage, savedFile: string, storageUsage: () => Promise<number | undefined>): Promise<string[]> {
  const sampler = new MemorySampler();
  await sampler.start();
  const started = Date.now();
  await popup.act("document.querySelector('#media-list .download').click();");
  const end = await waitForEnd(popup);
  const seconds = Math.round((Date.now() - started) / 1000);
  const memory = await sampler.stop();

  const problems: string[] = [];
  if (end !== SAVED_TEXT) {
    problems.push(`the large stream did not end as "${SAVED_TEXT}" after ${seconds} s: ${end}`);
    return problems;
  }

  const memoryText = memoryProblem(memory);
  if (memoryText !== undefined) {
    problems.push(memoryText);
  }
  const fileText = largeFileProblem(savedFile);
  if (fileText !== undefined) {
    problems.push(fileText);
  }

  const left = await leftoverStorage(storageUsage);
  if (left.mib !== undefined && left.mib > LEFTOVER_LIMIT_MIB) {
    problems.push(`${left.mib} MiB of temporary files were still in the extension's storage ${CLEANUP_WAIT_MS / 1000} s after the file was saved`);
  }
  const savedMib = existsSync(savedFile) ? Math.round(statSync(savedFile).size / MIB) : 0;
  const summary = `${savedMib} MiB saved in ${seconds} s; browser memory ${memory.baselineMib} MiB before, ${memory.peakMib} MiB at the peak (growth ${memory.growthMib} MiB, mostly ${memory.growers}); extension storage left afterwards: ${left.text}`;
  console.log(`${label} runtime: large stream: ${summary}`);
  return problems;
}
