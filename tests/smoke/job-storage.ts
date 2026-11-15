// What a job leaves in the extension's storage, read from the popup (same origin as the background and
// the offscreen document, so the same OPFS). Used by the job display check in both browsers.

const POLL_MS = 200;
const SETTLE_MS = 10_000;

/** Evaluates an expression whose value is a Promise, in the popup, and gives what it resolved to. */
export type EvaluatePromise = (expression: string) => Promise<unknown>;

// Opens the folder of all jobs (undefined when it was never made) and runs `body` on it.
function withJobsFolder(body: string, whenMissing: string): string {
  return `navigator.storage.getDirectory().then(async (root) => {
    let jobs;
    try { jobs = await root.getDirectoryHandle('streamdraft-jobs'); } catch (error) { if (error.name === 'NotFoundError') { return ${whenMissing}; } throw error; }
    ${body}
  })`;
}

const COUNT = withJobsFolder('let count = 0; for await (const name of jobs.keys()) { count++; } return count;', '0');

// A folder with a file in it, as a job that was cut off would leave it.
const PLANT = `navigator.storage.getDirectory().then(async (root) => {
  const jobs = await root.getDirectoryHandle('streamdraft-jobs', { create: true });
  const folder = await jobs.getDirectoryHandle('stray-smoke-job', { create: true });
  const writable = await (await folder.getFileHandle('segment-000000', { create: true })).createWritable();
  await writable.write(new Uint8Array(1024));
  await writable.close();
  return true;
})`;

export class JobStorage {
  private readonly evaluate: EvaluatePromise;

  constructor(evaluate: EvaluatePromise) {
    this.evaluate = evaluate;
  }

  /** How many job folders the storage holds; undefined when it could not be read. */
  async count(): Promise<number | undefined> {
    try {
      const value = await this.evaluate(COUNT);
      return typeof value === 'number' ? value : undefined;
    } catch (error) {
      console.error('smoke: could not read the job folders', error);
      return undefined;
    }
  }

  /** Leaves a job folder with a file in it, as a crash would. False when the browser would not take it. */
  async plantStray(): Promise<boolean> {
    try {
      return (await this.evaluate(PLANT)) === true;
    } catch (error) {
      console.error('smoke: could not plant a leftover job folder', error);
      return false;
    }
  }

  /** Waits until the storage holds exactly `expected` job folders; the last count read is the answer. */
  async settleAt(expected: number): Promise<number | undefined> {
    const deadline = Date.now() + SETTLE_MS;
    let count = await this.count();
    while (count !== expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      count = await this.count();
    }
    return count;
  }
}
