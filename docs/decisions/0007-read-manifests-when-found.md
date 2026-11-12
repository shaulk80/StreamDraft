# 0007: Read a stream's manifest as soon as it is found

Date: 2026-11-12. Status: accepted by the owner.

## Decision

When the network observer sees an HLS or DASH manifest for the first time on a tab, the background fetches it (with the user's cookies, the same limits as before) and stores the qualities, the protection or the error on the item. The popup still asks for the same on opening, which retries a manifest that could not be read.

The manifest also names the stream's own files: the playlists of an HLS master's renditions, and for DASH every initialisation and media segment (also of a protected stream). They are kept on the item as exact addresses (`partUrls`) and as numbered runs (`partRuns`: a prefix, a number and a suffix, so 500 segments cost one entry). A file the network observer finds that matches a stream's parts is not listed.

## Why

- Found on the Shaka Player demo: a stream cut into separate `.mp4` files served as `video/mp4` filled the list with 50 "Direct file" cards. Only `.ts` and `.m4s` names were skipped, and the parts of a stream were known only after the popup had read its manifest.
- The same lag made the toolbar badge count a rendition playlist (3 instead of 2) until the popup was opened.
- The manifest of a stream the user is watching comes from the host the page already talks to, so the rule "network calls go only to the media hosts" holds. The cost is one request per manifest found, also for pages the user never downloads from.

## Consequences

- Segments that arrive before the manifest is read are listed for a moment and dropped when it has been read (the manifest is fetched within milliseconds of being found).
- Not covered: the segments of an HLS master (they are in the rendition playlists, which are not read until a download), and DASH with several periods (the manifest gives an error). A player that streams from such a source can still fill the list with `.mp4` segments.
- Only a manifest's first sighting starts a read, so a live playlist that a player reloads every few seconds is not fetched again each time.
- Signed segment addresses are matched without their query.
