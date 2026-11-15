import { afterEach, describe, expect, test, vi } from 'vitest';
import { fail, ok } from '../../src/core/result.ts';
import { OpfsJobFolders } from '../../src/engine/opfs-job-folders.ts';
import { JOBS_DIRECTORY, type ListableDirectory } from '../../src/engine/opfs-store.ts';
import { FakeDirectory } from './fake-opfs.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A root with the given job folders, each holding a segment file. */
async function rootWithJobs(...jobIds: string[]): Promise<FakeDirectory> {
  const root = new FakeDirectory();
  const jobs = (await root.getDirectoryHandle(JOBS_DIRECTORY, { create: true })) as FakeDirectory;
  for (const jobId of jobIds) {
    const folder = await jobs.getDirectoryHandle(jobId, { create: true });
    await folder.getFileHandle('segment-000000', { create: true });
  }
  return root;
}

function foldersOf(root: ListableDirectory): OpfsJobFolders {
  return new OpfsJobFolders(() => Promise.resolve(ok(root)));
}

describe('OpfsJobFolders', () => {
  test.each<[string, string[]]>([
    ['no job folder was ever made', []],
    ['one job folder', ['a']],
    ['several job folders', ['a', 'b', 'c']],
  ])('lists the ids of the job folders: %s', async (_name, jobIds) => {
    const root = jobIds.length === 0 ? new FakeDirectory() : await rootWithJobs(...jobIds);

    const listed = await foldersOf(root).list();

    expect(listed).toEqual({ ok: true, value: jobIds });
  });

  test('removes a job folder with its files and leaves the others', async () => {
    const root = await rootWithJobs('a', 'b');
    const jobs = root.directories.get(JOBS_DIRECTORY);

    const removed = await foldersOf(root).remove('a');

    expect(removed.ok).toBe(true);
    expect([...(jobs?.directories.keys() ?? [])]).toEqual(['b']);
  });

  test.each<[string, () => Promise<FakeDirectory>]>([
    ['a folder that is not there', () => rootWithJobs('a')],
    ['storage with no job folders at all', () => Promise.resolve(new FakeDirectory())],
  ])('removing %s is not an error', async (_name, makeRoot) => {
    const removed = await foldersOf(await makeRoot()).remove('gone');

    expect(removed).toEqual({ ok: true, value: undefined });
  });

  test('the storage that cannot be opened is reported by both calls', async () => {
    const folders = new OpfsJobFolders(() => Promise.resolve(fail('No storage.')));

    expect(await folders.list()).toEqual({ ok: false, error: 'No storage.' });
    expect(await folders.remove('a')).toEqual({ ok: false, error: 'No storage.' });
  });

  test.each<[string, (jobs: FakeDirectory) => void, 'list' | 'remove']>([
    [
      'a listing that breaks',
      (jobs) => {
        jobs.keys = () => {
          throw new Error('listing broke');
        };
      },
      'list',
    ],
    [
      'a folder the browser will not remove',
      (jobs) => {
        jobs.removeEntry = () => Promise.reject(new DOMException('locked', 'NoModificationAllowedError'));
      },
      'remove',
    ],
  ])('says so, in words, when the browser fails: %s', async (_name, damage, call) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = await rootWithJobs('a');
    damage(root.directories.get(JOBS_DIRECTORY) as FakeDirectory);
    const folders = foldersOf(root);

    const result = call === 'list' ? await folders.list() : await folders.remove('a');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('temporary files');
  });
});
