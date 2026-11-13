# Test segments for the player capture page

`tests/pages/mse.html` plays these through Media Source Extensions. They are the first three media segments (12 seconds) and the init sections of three renditions of **Big Buck Bunny** from Akamai's public DASH test stream, `https://dash.akamaized.net/akamai/bbb_30fps/`:

| Folder | Source rendition | Content |
|---|---|---|
| `low/` | `bbb_30fps_320x180_200k` | H.264 `avc1.64000d`, 320x180, 30 fps, segments of 4 s |
| `high/` | `bbb_30fps_480x270_600k` | H.264 `avc1.640015`, 480x270, used for the quality switch |
| `audio/` | `bbb_a64k` | AAC (`mp4a.40.5`), 64 kbit/s |

`init.mp4` is the init section, `1.m4s` to `3.m4s` are the segments, byte for byte as served (downloaded 2026-11-13, 1.3 MB in all).

Licence: *Big Buck Bunny* is (c) 2008 Blender Foundation, https://www.bigbuckbunny.org, released under the Creative Commons Attribution 3.0 licence (https://creativecommons.org/licenses/by/3.0/). The files are used here unchanged, only as test data.
