# 0005: XML parsing for DASH manifests

Date: 2026-11-07. Status: accepted.

## Decision

A small XML reader of our own (`src/formats/xml.ts`, about 200 lines, no dependency) reads the manifests: elements, attributes, text, CDATA, comments and the five built-in entities plus numeric references.

## Why

- `DOMParser` is not available in the Chrome MV3 service worker, and Node (the unit tests) does not have it either. The parser has to run in both, with the same code.
- An MPD is plain, machine-written XML. The reader does not need namespaces (prefixes are dropped), schemas or XPath.
- A library such as fast-xml-parser would add a dependency to review, bundle and keep license-checked for a few hundred lines of work.
- Safety by construction: no entity is ever expanded beyond the built-in ones, a DOCTYPE with an internal subset is refused, and nesting uses a stack, so a hostile manifest cannot cause entity blow-up or a stack overflow.

## Consequences

- Unusual XML (external entities, processing-instruction logic, mixed content ordering) is not supported; the parser returns an error with a message instead.
- If a real manifest breaks it, add a fixture and fix the reader; switching to a library stays possible because only `parseXml` and the two lookup helpers are used.
