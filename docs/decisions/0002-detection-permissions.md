# 0002: Permissions for detection

Date: 2026-11-07. Status: accepted.

- **`webRequest` (observe only) and all-sites host access.** Videos are found from the response headers (content type, size) of requests the page makes, so the extension has to see every site's responses. It never blocks, redirects or changes a request, and it reads nothing but headers. No request body or page content leaves the browser (the project has no server).
- **Why not `activeTab` alone:** it grants access only after a click on the toolbar button, so the popup could not list videos that played before the click, and the in-page button needs a content script on every page anyway (already `<all_urls>` since M1).
- **Why no `tabs` permission:** host access covers reading the title and address of a tab, which is all that is used.
- **What the user sees:** Firefox lists "access your data for all websites" at install. The README explains each permission (M5).
- **Storage:** found videos are kept per tab in `storage.session` (gone when the browser closes), capped at 50 per tab. Nothing about them goes to `storage.sync` or `storage.local`.
- **Next permission:** `downloads`, added with the download task of M2.
- **Alternative if a reviewer objects:** optional host permissions requested at first use. It would cost the "works on every page right away" behaviour, so it is not used unless needed.
