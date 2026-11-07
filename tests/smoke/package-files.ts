import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

// What the Firefox and the Chrome smoke tests share: where the packages are and how to open one.

export const root = path.resolve(import.meta.dirname, '..', '..');
export const packageDir = path.join(root, 'dist', 'packages');

export function readVersion(): string {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  return packageJson.version;
}

/** Unpacks a zip package into `targetDir`, the way a browser would see the extension folder. */
export function extract(zipPath: string, targetDir: string): void {
  const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) {
      continue;
    }
    const target = path.join(targetDir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}
