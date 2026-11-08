import { readFileSync } from 'node:fs';
import path from 'node:path';
import { initSegment, mediaSegment, type FixtureTrack } from '../engine/mp4-fixtures.ts';

// Two tiny streams the engine can really download and join, built on start:
//  - DASH (fragmented MP4): a video and an audio representation of two one-second segments each,
//    made with the same builders as the unit tests;
//  - HLS (MPEG-TS): a media playlist of two real TS segments (the unit test fixtures).
// They are for the smoke tests and for trying a download by hand (`/download.html`); they do not play.

export interface GeneratedFile {
  contentType: string;
  body: Uint8Array | string;
}

const DASH_MANIFEST = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2S">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v1" bandwidth="800000" width="640" height="360" codecs="avc1.4d401e">
        <SegmentTemplate timescale="1000" duration="1000" startNumber="1" initialization="v1/init.mp4" media="v1/seg-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio">
      <Representation id="a1" bandwidth="64000" codecs="mp4a.40.2">
        <SegmentTemplate timescale="1000" duration="1000" startNumber="1" initialization="a1/init.mp4" media="a1/seg-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`;

const HLS_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:2.0,
seg0.ts
#EXTINF:2.0,
seg1.ts
#EXT-X-ENDLIST
`;

const FIXTURES = path.join(import.meta.dirname, '..', 'engine', 'fixtures');
const MP4 = 'video/mp4';
const SEGMENTS = 2;

function addRepresentation(files: Map<string, GeneratedFile>, folder: string, track: FixtureTrack): void {
  files.set(`/gen/dash/${folder}/init.mp4`, { contentType: MP4, body: initSegment([track]) });
  for (let number = 0; number < SEGMENTS; number++) {
    const samples = [
      { duration: 500, size: 40, sync: number === 0 },
      { duration: 500, size: 40, sync: false },
    ];
    const fragment = { trackId: track.id, startTime: number * 1000, firstIndex: number * 2, samples };
    files.set(`/gen/dash/${folder}/seg-${number + 1}.m4s`, { contentType: MP4, body: mediaSegment([fragment]) });
  }
}

/** The generated stream files by request path. */
export function generatedStreamFiles(): Map<string, GeneratedFile> {
  const files = new Map<string, GeneratedFile>();
  files.set('/gen/dash/manifest.mpd', { contentType: 'application/dash+xml', body: DASH_MANIFEST });
  addRepresentation(files, 'v1', { id: 1, kind: 'video', timescale: 1000 });
  addRepresentation(files, 'a1', { id: 1, kind: 'audio', timescale: 1000 });

  files.set('/gen/hls/index.m3u8', { contentType: 'application/vnd.apple.mpegurl', body: HLS_PLAYLIST });
  files.set('/gen/hls/seg0.ts', { contentType: 'video/mp2t', body: readFileSync(path.join(FIXTURES, 'bipbop-gop-a.mpegts')) });
  files.set('/gen/hls/seg1.ts', { contentType: 'video/mp2t', body: readFileSync(path.join(FIXTURES, 'bipbop-gop-b.mpegts')) });
  return files;
}
