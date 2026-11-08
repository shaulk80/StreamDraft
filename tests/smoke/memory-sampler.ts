import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// The memory of the browser under test, as Windows reports it (working set, sampled with wmic):
// everything the smoke test started, which is the driver, the browser and its helper processes.

const MIB = 1024 * 1024;
const SAMPLE_EVERY_MS = 1000;
const GROWERS_SHOWN = 3;
/** The kind of process in a Chrome (`--type=renderer`) or Firefox (`-contentproc ... tab`) command line. */
const PROCESS_KIND = /--type=([\w-]+)|-contentproc .*? (\w+)$/;

/** The label of the process that takes the measurement, which is not part of the browser. */
const MEASURING_TOOL = 'WMIC.exe';

const run = promisify(execFile);

interface ProcessRow {
  pid: number;
  parent: number;
  workingSet: number;
  /** When it started, as wmic writes it (`20261108162300.123456+120`); these sort by time. */
  created: string;
  /** The program and, when the command line names one, the kind of process. */
  label: string;
}

export interface MemoryMeasure {
  baselineMib: number;
  peakMib: number;
  growthMib: number;
  /** The processes that grew most between the start and the peak, for the log. */
  growers: string;
}

function labelOf(name: string, commandLine: string): string {
  const kind = PROCESS_KIND.exec(commandLine.trim());
  const found = kind?.[1] ?? kind?.[2];
  return found === undefined ? name : `${name} ${found}`;
}

async function processRows(): Promise<ProcessRow[]> {
  const { stdout } = await run('wmic', ['process', 'get', 'CommandLine,CreationDate,Name,ParentProcessId,ProcessId,WorkingSetSize', '/format:csv'], { maxBuffer: 64 * MIB });
  const rows: ProcessRow[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    // The command line may hold commas, so the five fixed columns are taken from the end.
    const cells = line.trim().split(',');
    if (cells[0] === undefined || cells[0] === 'Node' || cells.length < 6) {
      continue;
    }

    const [workingSet, pid, parent, name, created] = cells.slice(-5).reverse();
    const commandLine = cells.slice(1, -5).join(',');
    rows.push({ pid: Number(pid), parent: Number(parent), workingSet: Number(workingSet), created: created ?? '', label: labelOf(name ?? '', commandLine) });
  }
  return rows;
}

/** The processes this process started, not itself. */
async function startedProcesses(): Promise<ProcessRow[]> {
  const rows = (await processRows()).filter((row) => row.label !== MEASURING_TOOL);
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const inTree = new Set<number>([process.pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      // Windows keeps the parent number of a process whose parent has ended, and may give that number to a
      // new, unrelated process: a real child never starts before its parent.
      const parent = byPid.get(row.parent);
      if (!inTree.has(row.pid) && inTree.has(row.parent) && parent !== undefined && parent.created <= row.created) {
        inTree.add(row.pid);
        grew = true;
      }
    }
  }

  inTree.delete(process.pid);
  return rows.filter((row) => inTree.has(row.pid));
}

function totalMib(rows: readonly ProcessRow[]): number {
  return Math.round(rows.reduce((sum, row) => sum + row.workingSet, 0) / MIB);
}

function growersText(before: readonly ProcessRow[], peak: readonly ProcessRow[]): string {
  const startedWith = new Map(before.map((row) => [row.pid, row.workingSet]));
  const grown = peak.map((row) => ({ label: row.label, mib: Math.round((row.workingSet - (startedWith.get(row.pid) ?? 0)) / MIB) }));
  return grown
    .sort((a, b) => b.mib - a.mib)
    .slice(0, GROWERS_SHOWN)
    .map((row) => `${row.label} +${row.mib}`)
    .join(', ');
}

/** Samples the memory of the started processes every second until `stop`; growth is the peak minus the first sample. */
export class MemorySampler {
  private before: ProcessRow[] = [];
  private atPeak: ProcessRow[] = [];
  private running = false;
  private loop: Promise<void> = Promise.resolve();

  async start(): Promise<void> {
    this.before = await startedProcesses();
    this.atPeak = this.before;
    this.running = true;
    this.loop = this.sampleWhileRunning();
  }

  async stop(): Promise<MemoryMeasure> {
    this.running = false;
    await this.loop;
    const baselineMib = totalMib(this.before);
    const peakMib = totalMib(this.atPeak);
    return { baselineMib, peakMib, growthMib: peakMib - baselineMib, growers: growersText(this.before, this.atPeak) };
  }

  private async sampleWhileRunning(): Promise<void> {
    while (this.running) {
      try {
        const now = await startedProcesses();
        if (totalMib(now) > totalMib(this.atPeak)) {
          this.atPeak = now;
        }
      } catch (error) {
        console.error(error);
      }
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_EVERY_MS));
    }
  }
}
