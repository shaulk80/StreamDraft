import { spawnSync } from 'node:child_process';
import { classifyLicense } from './license-policy.ts';

// Checks the licenses of production dependencies (the code that ends up in the
// extension). Development tools are not redistributed and are not checked.
// Exit code 1 means a denied license or an unreadable result; warnings pass.

interface LicensePackage {
  name: string;
}

function fail(message: string): never {
  console.error(`check:licenses failed: ${message}`);
  process.exit(1);
}

const run = spawnSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  shell: true,
});

if (run.status !== 0) {
  fail(`pnpm licenses exited with ${String(run.status)}: ${run.stderr}`);
}

let byLicense: Record<string, LicensePackage[]> = {};
const output = run.stdout.trim();
if (output !== '') {
  try {
    byLicense = JSON.parse(output) as Record<string, LicensePackage[]>;
  } catch (error) {
    console.error(error);
    fail('could not parse the output of pnpm licenses');
  }
}

let denied = 0;
let warned = 0;
let total = 0;

for (const [license, packages] of Object.entries(byLicense)) {
  const verdict = classifyLicense(license);
  total += packages.length;
  const names = packages.map((entry) => entry.name).join(', ');
  if (verdict === 'denied') {
    denied += packages.length;
    console.error(`DENIED  ${license}: ${names}`);
  }
  if (verdict === 'warn') {
    warned += packages.length;
    console.warn(`WARNING ${license}: ${names}`);
  }
}

console.log(`Checked ${total} production package(s): ${denied} denied, ${warned} warning(s).`);
process.exit(denied > 0 ? 1 : 0);
