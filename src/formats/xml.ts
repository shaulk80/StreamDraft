import { fail, ok, type Result } from '../core/result.ts';

export interface XmlElement {
  /** Local name: a namespace prefix such as `xsi:` is removed. */
  name: string;
  /** Attribute values by local name; namespace declarations (`xmlns`) are left out. */
  attributes: ReadonlyMap<string, string>;
  children: XmlElement[];
  /** The text directly inside the element, entities decoded. */
  text: string;
}

const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const ATTRIBUTE_PATTERN = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const MAX_CODE_POINT = 0x10ffff;
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The part of a name after the last colon. */
function localName(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1);
}

function decodeEntity(match: string, entity: string): string {
  const named = NAMED_ENTITIES[entity.toLowerCase()];
  if (named !== undefined) {
    return named;
  }

  const isHex = entity.startsWith('#x') || entity.startsWith('#X');
  const codePoint = isHex ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
  if (!Number.isInteger(codePoint) || codePoint > MAX_CODE_POINT) {
    return match;
  }
  return String.fromCodePoint(codePoint);
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, decodeEntity);
}

function parseAttributes(body: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of body.matchAll(ATTRIBUTE_PATTERN)) {
    const [, rawName, doubleQuoted, singleQuoted] = match;
    if (rawName === undefined) {
      continue;
    }
    if (rawName === 'xmlns' || rawName.startsWith('xmlns:')) {
      continue;
    }
    attributes.set(localName(rawName), decodeEntities(doubleQuoted ?? singleQuoted ?? ''));
  }
  return attributes;
}

/** Where the tag that starts at `start` ends: the first `>` outside quotes, or -1. */
function findTagEnd(text: string, start: number): number {
  let quote: string | undefined;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== undefined) {
      quote = character === quote ? undefined : quote;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

/**
 * Reads the structure of a small XML document (a DASH manifest): elements,
 * attributes, text, CDATA, comments and the built-in entities. DOCTYPE
 * declarations with an internal subset are refused, so no entity can expand.
 * It does not use `DOMParser`, which the Chrome service worker and the unit
 * tests do not have. Nesting is tracked on a stack, not by recursion.
 */
export function parseXml(text: string): Result<XmlElement> {
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let position = 0;

  while (position < text.length) {
    const open = text.indexOf('<', position);
    const textEnd = open < 0 ? text.length : open;
    const top = stack[stack.length - 1];
    if (top) {
      top.text += decodeEntities(text.slice(position, textEnd));
    }
    if (open < 0) {
      break;
    }

    const hadParent = stack.length > 0;
    const step = readMarkup(text, open, stack);
    if (!step.ok) {
      return step;
    }
    position = step.value.next;

    const opened = step.value.opened;
    if (opened && !hadParent) {
      if (root) {
        return fail('The XML has more than one root element.');
      }
      root = opened;
    }
  }

  if (stack.length > 0) {
    return fail(`The XML ends inside <${stack[stack.length - 1]?.name ?? ''}>.`);
  }
  if (root === undefined) {
    return fail('The XML has no root element.');
  }
  return ok(root);
}

interface MarkupStep {
  /** Where reading goes on. */
  next: number;
  /** The element this markup opened, if it was a start tag. */
  opened?: XmlElement;
}

/** Reads the markup that starts at `open` (a `<`), updating the stack of open elements. */
function readMarkup(text: string, open: number, stack: XmlElement[]): Result<MarkupStep> {
  if (text.startsWith('<!--', open)) {
    return skipTo(text, '-->', open + 4, 'a comment');
  }
  if (text.startsWith('<![CDATA[', open)) {
    return readCdata(text, open, stack);
  }
  if (text.startsWith('<?', open)) {
    return skipTo(text, '?>', open + 2, 'a processing instruction');
  }
  if (text.startsWith('<!', open)) {
    return readDeclaration(text, open);
  }
  if (text.startsWith('</', open)) {
    return readEndTag(text, open, stack);
  }
  return readStartTag(text, open, stack);
}

function skipTo(text: string, terminator: string, from: number, what: string): Result<MarkupStep> {
  const end = text.indexOf(terminator, from);
  if (end < 0) {
    return fail(`The XML ends inside ${what}.`);
  }
  return ok({ next: end + terminator.length });
}

function readCdata(text: string, open: number, stack: XmlElement[]): Result<MarkupStep> {
  const start = open + '<![CDATA['.length;
  const end = text.indexOf(']]>', start);
  if (end < 0) {
    return fail('The XML ends inside a CDATA section.');
  }

  const top = stack[stack.length - 1];
  if (top) {
    top.text += text.slice(start, end);
  }
  return ok({ next: end + ']]>'.length });
}

function readDeclaration(text: string, open: number): Result<MarkupStep> {
  const end = text.indexOf('>', open);
  if (end < 0) {
    return fail('The XML ends inside a declaration.');
  }
  if (text.slice(open, end).includes('[')) {
    return fail('A DOCTYPE with an internal subset is not supported.');
  }
  return ok({ next: end + 1 });
}

function readEndTag(text: string, open: number, stack: XmlElement[]): Result<MarkupStep> {
  const end = text.indexOf('>', open);
  if (end < 0) {
    return fail('The XML ends inside a closing tag.');
  }

  const name = localName(text.slice(open + 2, end).trim());
  const top = stack.pop();
  if (top?.name !== name) {
    return fail(`The closing tag </${name}> does not match <${top?.name ?? 'nothing'}>.`);
  }
  return ok({ next: end + 1 });
}

function readStartTag(text: string, open: number, stack: XmlElement[]): Result<MarkupStep> {
  const end = findTagEnd(text, open + 1);
  if (end < 0) {
    return fail('The XML ends inside a tag.');
  }

  const selfClosing = text[end - 1] === '/';
  const body = text.slice(open + 1, selfClosing ? end - 1 : end);
  const nameLength = body.search(/\s/);
  const rawName = nameLength < 0 ? body : body.slice(0, nameLength);
  if (rawName.length === 0) {
    return fail('The XML has a tag without a name.');
  }

  const element: XmlElement = {
    name: localName(rawName),
    attributes: parseAttributes(nameLength < 0 ? '' : body.slice(nameLength)),
    children: [],
    text: '',
  };
  stack[stack.length - 1]?.children.push(element);
  if (!selfClosing) {
    stack.push(element);
  }
  return ok({ next: end + 1, opened: element });
}

/** The direct children with this name. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** The first direct child with this name. */
export function childNamed(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((child) => child.name === name);
}
