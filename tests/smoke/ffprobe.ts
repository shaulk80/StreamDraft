import { spawnSync } from 'node:child_process';

// An outside opinion on the files the smoke tests download: ffprobe reads them with a real
// demuxer, which is stricter than our own box reader. It is optional: without ffprobe the
// callers keep the check by box structure (FFPROBE_BIN chooses a binary).

export type FfprobeKinds = { ok: true; kinds: string[] } | { ok: false; error: string };

const FFPROBE_TIMEOUT_MS = 30_000;
let absentNoted = false;

/** The stream kinds (`video`, `audio`, sorted) in the JSON that `ffprobe -show_entries stream=codec_type -of json` prints. */
export function parseFfprobeKinds(json: string): FfprobeKinds {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, error: `ffprobe printed no JSON: ${String(error)}` };
  }

  const streams = (parsed as { streams?: unknown } | null)?.streams;
  if (!Array.isArray(streams)) {
    return { ok: false, error: 'ffprobe printed no list of streams' };
  }

  const kinds = streams.map((stream) => String((stream as { codec_type?: unknown } | null)?.codec_type));
  return { ok: true, kinds: kinds.sort() };
}

/**
 * A problem text when ffprobe cannot read the file or finds other streams than `expectedKinds`,
 * otherwise undefined (also when ffprobe is not installed, which is said once).
 */
export function ffprobeProblem(filePath: string, expectedKinds: readonly string[]): string | undefined {
  const binary = process.env['FFPROBE_BIN'] || 'ffprobe';
  const run = spawnSync(binary, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', filePath], { encoding: 'utf8', timeout: FFPROBE_TIMEOUT_MS });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') {
    if (!absentNoted) {
      absentNoted = true;
      console.log(`ffprobe not found (${binary}): downloaded streams are checked by their box structure only`);
    }
    return undefined;
  }
  if (run.error) {
    return `ffprobe could not run: ${String(run.error)}`;
  }

  const complaint = run.stderr.trim();
  if (run.status !== 0 || complaint !== '') {
    return `ffprobe does not accept the file (exit ${String(run.status)}): ${complaint}`;
  }

  const found = parseFfprobeKinds(run.stdout);
  if (!found.ok) {
    return found.error;
  }

  const expected = [...expectedKinds].sort();
  return JSON.stringify(found.kinds) === JSON.stringify(expected) ? undefined : `ffprobe finds streams [${found.kinds.join(', ')}], expected [${expected.join(', ')}]`;
}
