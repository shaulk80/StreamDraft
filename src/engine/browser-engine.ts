import { fail, ok, type Result } from '../core/result.ts';
import { createManifestFetcher } from '../detect/manifest-fetch.ts';
import type { EngineSignal } from './engine-types.ts';
import { OpfsJobFolders } from './opfs-job-folders.ts';
import { OpfsSegmentStore, type ListableDirectory } from './opfs-store.ts';
import { createSegmentFetcher } from './segment-fetcher.ts';
import { StreamEngine, type JobFiles } from './stream-engine.ts';

const NO_STORAGE = 'The browser would not give the extension space to store the download. Private windows do not allow it.';

async function openOpfsRoot(): Promise<Result<ListableDirectory>> {
  try {
    return ok((await navigator.storage.getDirectory()) as unknown as ListableDirectory);
  } catch (error) {
    console.error('StreamDraft: the private file system is not available', error);
    return fail(NO_STORAGE);
  }
}

async function openOpfsJobFiles(jobId: string): Promise<Result<JobFiles>> {
  const root = await openOpfsRoot();
  if (!root.ok) {
    return root;
  }
  return OpfsSegmentStore.open(root.value, jobId);
}

/** The engine wired to the real browser: `fetch` with the user's cookies, OPFS for files, Blob addresses. */
export function createBrowserEngine(notify: (signal: EngineSignal) => void): StreamEngine {
  return new StreamEngine({
    openFiles: openOpfsJobFiles,
    jobFolders: new OpfsJobFolders(openOpfsRoot),
    fetchText: createManifestFetcher((url, init) => fetch(url, init)),
    fetchSegment: createSegmentFetcher((url, init) => fetch(url, init)),
    // A slice of the OPFS file stays on disk; it only carries the type.
    createObjectUrl: (file, mimeType) => URL.createObjectURL((file as unknown as Blob).slice(0, file.size, mimeType)),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    notify,
  });
}
