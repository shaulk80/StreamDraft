import { fail, ok, type Result } from '../../core/result.ts';
import { concatBytes } from '../../engine/mp4/bytes.ts';

/** A piece of a fragmented MP4 stream: the init section, or one media segment (`moof` with its `mdat`). */
export interface AssembledPart {
  kind: 'init' | 'segment';
  bytes: Uint8Array;
}

export const DAMAGED_STREAM = 'The video data of the page is damaged.';

const HEADER = 8;
const LARGE_HEADER = 16;
const LARGE_SIZE_MARKER = 1;
/** A single box larger than this is not a media segment of a web player. */
const MAX_BOX_BYTES = 512 * 1024 * 1024;
/** Boxes that carry no media and that no one needs. */
const IGNORED = new Set(['free', 'skip']);

function typeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

/**
 * Cuts the bytes a player appends to a source buffer into the pieces the
 * recorder works with. The player appends in pieces of any size (a few
 * kilobytes at a time on YouTube), and a piece may end in the middle of a box;
 * this holds the rest until the box is whole. Init section: `ftyp` and `moov`.
 * Media segment: the boxes before a `moof` that belong to it (`styp`, `sidx`,
 * `emsg`), the `moof` and its `mdat`.
 */
export class SegmentAssembler {
  private chunks: Uint8Array[] = [];
  private held = 0;
  private broken = false;
  private initBoxes: Uint8Array[] = [];
  private lead: Uint8Array[] = [];
  private segment: Uint8Array[] | undefined;

  push(chunk: Uint8Array): Result<AssembledPart[]> {
    if (this.broken) {
      return fail(DAMAGED_STREAM);
    }

    this.chunks.push(chunk);
    this.held += chunk.length;
    const parts: AssembledPart[] = [];
    for (;;) {
      const size = this.nextBoxSize();
      if (!size.ok) {
        this.broken = true;
        return size;
      }
      if (size.value === undefined || this.held < size.value) {
        return ok(parts);
      }

      const box = this.take(size.value);
      const part = this.group(box);
      if (part !== undefined) {
        parts.push(part);
      }
    }
  }

  /** The size of the box at the front, or undefined while its header is not complete yet. */
  private nextBoxSize(): Result<number | undefined> {
    if (this.held < HEADER) {
      return ok(undefined);
    }

    const head = this.peek(Math.min(this.held, LARGE_HEADER));
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    if (size === LARGE_SIZE_MARKER) {
      if (head.length < LARGE_HEADER) {
        return ok(undefined);
      }
      size = Number(view.getBigUint64(HEADER));
    }

    // Size 0 ("to the end of the stream") has no end in a live feed; sizes below a header are nonsense.
    if (size < HEADER || size > MAX_BOX_BYTES) {
      return fail(DAMAGED_STREAM);
    }
    return ok(size);
  }

  private peek(length: number): Uint8Array {
    const [first] = this.chunks;
    if (first !== undefined && first.length >= length) {
      return first.subarray(0, length);
    }
    return concatBytes(this.chunks).subarray(0, length);
  }

  private take(length: number): Uint8Array {
    const taken: Uint8Array[] = [];
    let missing = length;
    while (missing > 0) {
      const [first] = this.chunks;
      if (first === undefined) {
        break;
      }
      if (first.length <= missing) {
        taken.push(first);
        missing -= first.length;
        this.chunks.shift();
        continue;
      }
      taken.push(first.subarray(0, missing));
      this.chunks[0] = first.subarray(missing);
      missing = 0;
    }
    this.held -= length;
    return concatBytes(taken);
  }

  /** Puts a whole box where it belongs; returns a part when one is finished. */
  private group(box: Uint8Array): AssembledPart | undefined {
    const type = typeAt(box, 4);
    if (IGNORED.has(type)) {
      return undefined;
    }

    if (type === 'ftyp') {
      this.initBoxes = [box];
      return undefined;
    }
    if (type === 'moov') {
      const bytes = concatBytes([...this.initBoxes, box]);
      this.initBoxes = [];
      return { kind: 'init', bytes };
    }
    if (type === 'moof') {
      this.segment = [...this.lead, box];
      this.lead = [];
      return undefined;
    }
    if (type === 'mdat') {
      const segment = this.segment;
      this.segment = undefined;
      return segment === undefined ? undefined : { kind: 'segment', bytes: concatBytes([...segment, box]) };
    }

    // styp, sidx, emsg and the like: they belong to the segment that follows.
    this.lead.push(box);
    return undefined;
  }
}
