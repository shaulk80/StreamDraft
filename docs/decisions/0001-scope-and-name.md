# 0001: Scope, name, stack, distribution

Date: 2026-11-02. Status: accepted.

- **Name:** StreamDraft, chosen by the owner. Checked 2026-11-02: no npm package, no GitHub user or org, no AMO add-on, no web hits for a product. Two unrelated tiny GitHub repos contain the word. USPTO, TMview and WIPO were not searched.
- **Product:** browser extension that downloads videos from the current page. Firefox is primary, Chrome secondary. Hobby project for the owner, simple installation.
- **v1 scope:** direct files (mp4/webm), HLS and DASH streams, audio-only extraction, site-specific extractors (YouTube first). No helper program (browser-only). Non-goals: DRM-protected streams, live-stream recording, Firefox for Android, other browsers.
- **UX:** in-page download button and context-menu entry, each switchable in the options page.
- **Stack:** TypeScript, WXT (Manifest V3, one codebase for both browsers), Vitest, web-ext, pnpm. Node 26 (the owner's installed version; CI uses the same). TypeScript 6.0 until typescript-eslint supports 7.
- **Distribution:** Firefox via unlisted AMO signing, installed from GitHub Releases, updates through `update_url` (M5). Chrome as a zip from GitHub Releases loaded in developer mode. No store listing in v1.
- **Gates and fallback:** Mozilla signing is mandatory for release Firefox. If Mozilla declines or blocks it, use Firefox Developer Edition or ESR with `xpinstall.signatures.required` off. Chrome Web Store is not used, so a rejection there cannot block v1. Everything in M0 to M4 works unsigned.
- **CI platforms:** Windows only (owner's choice). Linux and macOS jobs can be added later; the extension itself is OS-independent.
- **License and visibility:** Apache-2.0, public repository `shaulk80/StreamDraft`.
- **Risk accepted:** site extractors (YouTube) break often and may conflict with store policies; they come last (M4) behind a go/no-go gate.
