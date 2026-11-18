import { initSegment, mediaSegment, type FixtureSample, type FixtureTrack } from '../engine/mp4-fixtures.ts';
import type { GeneratedFile } from './generated-stream.ts';

// DASH streams of more than 1 GiB for the large file checks (`/large.html`, 1.1 GiB, and `/huge.html`,
// 4.5 GiB: past 4 GiB, where 32-bit sizes and offsets stop working). Nothing is stored: every segment
// is built when it is asked for (16 MiB each), so the repository and the disk stay small and only the
// browser under test ever holds the whole stream. Like the other generated streams they do not play;
// their samples are filler that tells their index apart.

const MIB = 1024 * 1024;
export const LARGE_SAMPLES_PER_SEGMENT = 16;
export const LARGE_VIDEO_SAMPLE_BYTES = MIB;
export const LARGE_AUDIO_SAMPLE_BYTES = 1024;
const SAMPLE_MS = 500;
const SEGMENT_MS = LARGE_SAMPLES_PER_SEGMENT * SAMPLE_MS;
const MP4 = 'video/mp4';

export interface StreamProfile {
  /** The folder under `/gen/`, also the name of the test page (`/<folder>.html`). */
  folder: string;
  segments: number;
  /** The picture and the sound of the stream together, as the muxed file holds them (the sample bytes only). */
  streamBytes: number;
  /** The samples of each track in the finished file: the picture, then the sound. */
  trackSamples: number[];
}

function profileOf(folder: string, segments: number): StreamProfile {
  const samples = segments * LARGE_SAMPLES_PER_SEGMENT;
  return {
    folder,
    segments,
    streamBytes: samples * (LARGE_VIDEO_SAMPLE_BYTES + LARGE_AUDIO_SAMPLE_BYTES),
    trackSamples: [samples, samples],
  };
}

/** 1.1 GiB: the check that runs in every release. */
export const LARGE: StreamProfile = profileOf('large', 68);
/** 4.5 GiB: more than a 32-bit offset can address, for the long video check (M6). */
export const HUGE: StreamProfile = profileOf('huge', 288);
export const PROFILES: readonly StreamProfile[] = [LARGE, HUGE];

const VIDEO: FixtureTrack = { id: 1, kind: 'video', timescale: 1000 };
const AUDIO: FixtureTrack = { id: 1, kind: 'audio', timescale: 1000 };

function manifestOf(profile: StreamProfile): string {
  return `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${(profile.segments * SEGMENT_MS) / 1000}S">
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
}

const SEGMENT_PATH = /^\/gen\/([a-z]+)\/([va])\/seg-(\d+)\.m4s$/;

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

function segmentFile(profile: StreamProfile, match: RegExpExecArray): GeneratedFile | undefined {
  const number = Number(match[3]) - 1;
  if (number < 0 || number >= profile.segments) {
    return undefined;
  }

  const isVideo = match[2] === 'v';
  const body = isVideo ? segmentOf(VIDEO, number, LARGE_VIDEO_SAMPLE_BYTES) : segmentOf(AUDIO, number, LARGE_AUDIO_SAMPLE_BYTES);
  return { contentType: MP4, body };
}

/** The file for a request path under `/gen/large/` or `/gen/huge/`, built now, or undefined for any other path. */
export function largeStreamFile(pathname: string): GeneratedFile | undefined {
  const match = SEGMENT_PATH.exec(pathname);
  if (match) {
    const profile = PROFILES.find((candidate) => candidate.folder === match[1]);
    return profile === undefined ? undefined : segmentFile(profile, match);
  }

  for (const profile of PROFILES) {
    const base = `/gen/${profile.folder}/`;
    if (pathname === `${base}manifest.mpd`) {
      return { contentType: 'application/dash+xml', body: manifestOf(profile) };
    }
    if (pathname === `${base}v/init.mp4`) {
      return { contentType: MP4, body: initSegment([VIDEO]) };
    }
    if (pathname === `${base}a/init.mp4`) {
      return { contentType: MP4, body: initSegment([AUDIO]) };
    }
  }
  return undefined;
}
