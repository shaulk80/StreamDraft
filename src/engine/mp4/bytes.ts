/** A box of an MP4 file: where it starts and ends, and where its content starts. */
export interface Box {
  type: string;
  start: number;
  end: number;
  /** First byte after the box header. */
  body: number;
}

const HEADER_SIZE = 8;
const LARGE_HEADER_SIZE = 16;
const LARGE_SIZE_MARKER = 1;
const UINT32_RANGE = 0x1_0000_0000;

export function viewOf(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

export function textAt(data: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...data.subarray(start, start + length));
}

/**
 * The boxes between `start` and `end`. Stops at the first box whose size is
 * impossible (smaller than its header, or past `end`), so a damaged file gives
 * a short list and the caller's search for a mandatory box fails.
 */
export function readBoxes(data: Uint8Array, start: number = 0, end: number = data.length): Box[] {
  const view = viewOf(data);
  const boxes: Box[] = [];
  let position = start;
  while (position + HEADER_SIZE <= end) {
    let size = view.getUint32(position);
    let headerSize = HEADER_SIZE;
    if (size === LARGE_SIZE_MARKER) {
      if (position + LARGE_HEADER_SIZE > end) {
        break;
      }
      size = Number(view.getBigUint64(position + HEADER_SIZE));
      headerSize = LARGE_HEADER_SIZE;
    } else if (size === 0) {
      size = end - position;
    }

    if (size < headerSize || position + size > end) {
      break;
    }
    boxes.push({ type: textAt(data, position + 4, 4), start: position, end: position + size, body: position + headerSize });
    position += size;
  }
  return boxes;
}

export function childBoxes(data: Uint8Array, parent: Box): Box[] {
  return readBoxes(data, parent.body, parent.end);
}

export function findBox(boxes: readonly Box[], type: string): Box | undefined {
  return boxes.find((candidate) => candidate.type === type);
}

export function sliceBox(data: Uint8Array, box: Box): Uint8Array {
  return data.slice(box.start, box.end);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}

export function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

export function u8(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

export function u16(...values: number[]): Uint8Array {
  const result = new Uint8Array(values.length * 2);
  const view = viewOf(result);
  values.forEach((value, index) => view.setUint16(index * 2, value));
  return result;
}

/** Big-endian 32-bit values; negative numbers are written as two's complement. */
export function u32(...values: number[]): Uint8Array {
  const result = new Uint8Array(values.length * 4);
  const view = viewOf(result);
  values.forEach((value, index) => view.setUint32(index * 4, value >>> 0));
  return result;
}

export function u64(value: number): Uint8Array {
  const result = new Uint8Array(8);
  viewOf(result).setBigUint64(0, BigInt(value));
  return result;
}

export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concatBytes(parts);
  return concatBytes([u32(body.length + HEADER_SIZE), ascii(type), body]);
}

export function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, u32(((version << 24) | flags) >>> 0), ...parts);
}

/** True when `value` does not fit in 32 bits. */
export function needsWide(value: number): boolean {
  return value >= UINT32_RANGE;
}
