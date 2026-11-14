import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { fail, ok, type Result } from '../src/core/result.ts';
import { buildUpdateManifest, readAddonInfo } from './update-manifest.ts';

// Writes updates.json for a signed .xpi (decision 0011).
//   node scripts/make-update-manifest.ts --xpi <file.xpi> --url <https address of the .xpi> --out <updates.json>
// The ID, version and lowest Firefox version are read from the manifest inside the .xpi,
// so the file cannot disagree with the package it describes.
// Exit code 1 means the manifest could not be built; the reason is printed.

function readArguments(argv: string[]): Result<Record<'xpi' | 'url' | 'out', string>> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index] ?? '';
    const value = argv[index + 1];
    if (!name.startsWith('--') || value === undefined) {
      return fail(`unexpected argument "${name}"`);
    }
    values[name.slice(2)] = value;
  }
  for (const name of ['xpi', 'url', 'out']) {
    if (values[name] === undefined) {
      return fail(`missing --${name}`);
    }
  }
  return ok({ xpi: values['xpi'] ?? '', url: values['url'] ?? '', out: values['out'] ?? '' });
}

function readPackage(path: string): Result<{ manifest: unknown; sha256: string }> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    console.error(error);
    return fail(`cannot read ${path}`);
  }
  try {
    const manifestBytes = unzipSync(new Uint8Array(bytes), { filter: (file) => file.name === 'manifest.json' })['manifest.json'];
    if (manifestBytes === undefined) {
      return fail(`${path} has no manifest.json`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return ok({ manifest: JSON.parse(strFromU8(manifestBytes)) as unknown, sha256 });
  } catch (error) {
    console.error(error);
    return fail(`${path} is not a readable package`);
  }
}

function run(): Result<string> {
  const args = readArguments(process.argv.slice(2));
  if (!args.ok) {
    return args;
  }
  const pack = readPackage(args.value.xpi);
  if (!pack.ok) {
    return pack;
  }
  const info = readAddonInfo(pack.value.manifest);
  if (!info.ok) {
    return info;
  }
  const manifest = buildUpdateManifest({ ...info.value, updateLink: args.value.url, sha256: pack.value.sha256 });
  if (!manifest.ok) {
    return manifest;
  }
  try {
    writeFileSync(args.value.out, `${JSON.stringify(manifest.value, null, 2)}\n`);
  } catch (error) {
    console.error(error);
    return fail(`cannot write ${args.value.out}`);
  }
  return ok(`wrote ${args.value.out} for version ${info.value.version}`);
}

const outcome = run();
if (outcome.ok) {
  console.log(outcome.value);
} else {
  console.error(`make-update-manifest failed: ${outcome.error}`);
  process.exit(1);
}
