import { describe, expect, test } from 'vitest';
import { childNamed, childrenNamed, parseXml, type XmlElement } from '../../src/formats/xml.ts';

function parseOk(text: string): XmlElement {
  const result = parseXml(text);
  if (!result.ok) {
    expect.fail(`expected the XML to parse: ${result.error}`);
  }
  return result.value;
}

describe('parseXml', () => {
  test('reads elements, attributes, text, CDATA and skips the prolog and comments', () => {
    const root = parseOk(
      `<?xml version="1.0"?>\n<!-- note --><MPD xmlns="urn:x" xmlns:xsi="u" xsi:schemaLocation="s" type='static'><a b="1 &amp; 2">t&lt;<![CDATA[<raw>]]></a><c/></MPD>`,
    );

    expect(root.name).toBe('MPD');
    expect(Object.fromEntries(root.attributes)).toEqual({ schemaLocation: 's', type: 'static' });
    expect(root.children.map((child) => child.name)).toEqual(['a', 'c']);
    expect(childNamed(root, 'a')?.attributes.get('b')).toBe('1 & 2');
    expect(childNamed(root, 'a')?.text).toBe('t<<raw>');
  });

  test('removes namespace prefixes from element names', () => {
    const root = parseOk('<ns:root xmlns:ns="urn:x"><ns:item/><ns:item/><other/></ns:root>');

    expect(root.name).toBe('root');
    expect(childrenNamed(root, 'item')).toHaveLength(2);
  });

  test.each([
    ['&#65;', 'A'],
    ['&#x41;', 'A'],
    ['&quot;&apos;&lt;&gt;&amp;', `"'<>&`],
    ['&#1114112;', '&#1114112;'],
    ['&unknown;', '&unknown;'],
  ])('decodes the entity text %s', (encoded, expected) => {
    expect(parseOk(`<a>${encoded}</a>`).text).toBe(expected);
  });

  test('keeps a greater-than sign inside an attribute value', () => {
    const root = parseOk('<a b="x>y"><c/></a>');

    expect(root.attributes.get('b')).toBe('x>y');
    expect(root.children).toHaveLength(1);
  });

  test.each([
    ['a closing tag that does not match', '<a><b></a>', 'The closing tag </a> does not match <b>.'],
    ['a closing tag with nothing open', '</a>', 'The closing tag </a> does not match <nothing>.'],
    ['an element left open', '<a>', 'The XML ends inside <a>.'],
    ['a tag cut off', '<a', 'The XML ends inside a tag.'],
    ['an empty text', '  ', 'The XML has no root element.'],
    ['two roots', '<a/><b/>', 'The XML has more than one root element.'],
    ['two roots with content', '<a></a><b></b>', 'The XML has more than one root element.'],
    ['a comment left open', '<a><!-- x', 'The XML ends inside a comment.'],
    ['a CDATA section left open', '<a><![CDATA[x', 'The XML ends inside a CDATA section.'],
    ['a DOCTYPE with entity declarations', '<!DOCTYPE a [<!ENTITY x "y">]><a/>', 'A DOCTYPE with an internal subset is not supported.'],
  ])('%s gives an error', (_name, text, message) => {
    expect(parseXml(text)).toEqual({ ok: false, error: message });
  });

  test('accepts a DOCTYPE without an internal subset', () => {
    expect(parseOk('<!DOCTYPE MPD><MPD/>').name).toBe('MPD');
  });

  test('reads a deeply nested document without recursion', () => {
    const depth = 20000;
    const text = `${'<a>'.repeat(depth)}${'</a>'.repeat(depth)}`;

    expect(parseXml(text).ok).toBe(true);
  });
});
