import { initSegment, mediaSegment, type FixtureSample, type FixtureTrack } from '../engine/mp4-fixtures.ts';
import type { GeneratedFile } from './generated-stream.ts';

// A DASH stream of more than 1 GiB for the large file check (`/large.html`). Nothing is stored:
// every segment is built when it is asked for (16 MiB each), so the repository and the disk stay
// small and only the browser under test ever holds the whole stream. Like the other generated
// streams it does not play; its samples are filler that tells their index apart.

const MIB = 1024 * 1024;
export const LARGE_SEGMENTS = 68;
export const LARGE_SAMPLES_PER_SEGMENT = 16;
export const LARGE_VIDEO_SAMPLE_BYTES = MIB;
export const LARGE_AUDIO_SAMPLE_BYTES = 1024;
const SAMPLE_MS = 500;
const SEGMENT_MS = LARGE_SAMPLES_PER_SEGMENT * SAMPLE_MS;
const MP4 = 'video/mp4';

/** The picture and the sound of the stream together, as the muxed file holds them (the sample bytes only). */
export const LARGE_STREAM_BYTES = LARGE_SEGMENTS * LARGE_SAMPLES_PER_SEGMENT * (LARGE_VIDEO_SAMPLE_BYTES + LARGE_AUDIO_SAMPLE_BYTES);
/** The samples of each track in the finished file: the picture, then the sound. */
export const LARGE_TRACK_SAMPLES = [LARGE_SEGMENTS * LARGE_SAMPLES_PER_SEGMENT, LARGE_SEGMENTS * LARGE_SAMPLES_PER_SEGMENT];

const VIDEO: FixtureTrack = { id: 1, kind: 'video', timescale: 1000 };
const AUDIO: FixtureTrack = { id: 1, kind: 'audio', timescale: 1000 };

const MANIFEST = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${(LARGE_SEGMENTS * SEGMENT_MS) / 1000}S">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v1" bandwidth="17000000" width="1280" height="720" codecs="avc1.4d401f">
        <SegmentTemplate timescale="1000" duration="${SEGMENT_MS}" startNumber="1" initialization="v/init.mp4" media="v/seg-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio">
      <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2">
        <SegmentTemplate timescale="1000" duration="${SEGMENT_MS}" startNumber="1" initialization="a/init.mp4" media="a/seg-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`;

const SEGMENT_PATH = /^\/gen\/large\/([va])\/seg-(\d+)\.m4s$/;

function segmentOf(track: FixtureTrack, number: number, sampleBytes: number): Uint8Array {
  const samples: FixtureSample[] = Array.from({ length: LARGE_SAMPLES_PER_SEGMENT }, (_unused, index) => ({
    duration: SAMPLE_MS,
    size: sampleBytes,
    sync: number === 0 && index === 0,
  }));
  const fragment = { trackId: track.id, startTime: number * SEGMENT_MS, firstIndex: number * LARGE_SAMPLES_PER_SEGMENT, samples };
  return mediaSegment([fragment]);
}

/** The byte every byte of sample `index` of a track holds, for the check of the finished file. */
export function largeSampleFill(index: number): number {
  return (VIDEO.id * 41 + index) & 0xff;
}

/** The file for a request path under `/gen/large/`, built now, or undefined for any other path. */
export function largeStreamFile(pathname: string): GeneratedFile | undefined {
  if (pathname === '/gen/large/manifest.mpd') {
    return { contentType: 'application/dash+xml', body: MANIFEST };
  }
  if (pathname === '/gen/large/v/init.mp4') {
    return { contentType: MP4, body: initSegment([VIDEO]) };
  }
  if (pathname === '/gen/large/a/init.mp4') {
    return { contentType: MP4, body: initSegment([AUDIO]) };
  }

  const match = SEGMENT_PATH.exec(pathname);
  if (!match) {
    return undefined;
  }

  const number = Number(match[2]) - 1;
  if (number < 0 || number >= LARGE_SEGMENTS) {
    return undefined;
  }

  const isVideo = match[1] === 'v';
  const body = isVideo ? segmentOf(VIDEO, number, LARGE_VIDEO_SAMPLE_BYTES) : segmentOf(AUDIO, number, LARGE_AUDIO_SAMPLE_BYTES);
  return { contentType: MP4, body };
}
