import { fail, ok, type Result } from '../core/result.ts';
import { JOBS_DIRECTORY, type ListableDirectory } from './opfs-store.ts';

/** The job folders in storage, listed and removed by name; what the engine sweeps with. */
export interface JobFolders {
  /** The ids of all job folders. */
  list(): Promise<Result<string[]>>;
  /** Removes one job folder with everything in it; a folder that is not there is not an error. */
  remove(jobId: string): Promise<Result<void>>;
}

const NOT_FOUND = 'NotFoundError';

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === NOT_FOUND;
}

/** The job folders of the extension's OPFS. */
export class OpfsJobFolders implements JobFolders {
  constructor(private readonly openRoot: () => Promise<Result<ListableDirectory>>) {}

  async list(): Promise<Result<string[]>> {
    const jobs = await this.openJobs();
    if (!jobs.ok) {
      return jobs;
    }
    if (jobs.value === undefined) {
      return ok([]);
    }

    try {
      const ids: string[] = [];
      for await (const name of jobs.value.keys()) {
        ids.push(name);
      }
      return ok(ids);
    } catch (error) {
      console.error('StreamDraft: could not list the download folders', error);
      return fail('The temporary files of earlier downloads could not be listed.');
    }
  }

  async remove(jobId: string): Promise<Result<void>> {
    const jobs = await this.openJobs();
    if (!jobs.ok) {
      return jobs;
    }
    if (jobs.value === undefined) {
      return ok(undefined);
    }

    try {
      await jobs.value.removeEntry(jobId, { recursive: true });
      return ok(undefined);
    } catch (error) {
      if (isNotFound(error)) {
        return ok(undefined);
      }
      console.error(`StreamDraft: could not remove the files of job ${jobId}`, error);
      return fail('The temporary files of a download could not be removed.');
    }
  }

  /** The folder of all jobs, or undefined when none was ever made. */
  private async openJobs(): Promise<Result<ListableDirectory | undefined>> {
    const root = await this.openRoot();
    if (!root.ok) {
      return root;
    }

    try {
      return ok((await root.value.getDirectoryHandle(JOBS_DIRECTORY, { create: false })) as ListableDirectory);
    } catch (error) {
      if (isNotFound(error)) {
        return ok(undefined);
      }
      console.error('StreamDraft: could not open the download folders', error);
      return fail('The temporary files of earlier downloads could not be reached.');
    }
  }
}
