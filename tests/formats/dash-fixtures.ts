/** Manifests for the DASH parser tests. The first two are cut down from public test streams (see docs/spikes/samples). */

export const MANIFEST_URL = 'https://cdn.example.com/dash/manifest.mpd';

const NAMESPACE = 'xmlns="urn:mpeg:dash:schema:mpd:2011"';

/** Akamai Big Buck Bunny: one `SegmentTemplate` per adaptation set, number addressing, separate video and audio. */
export const TEMPLATE_MANIFEST = `<MPD mediaPresentationDuration="PT634.566S" minBufferTime="PT2.00S" type="static" ${NAMESPACE}>
 <BaseURL>./</BaseURL>
 <Period>
  <AdaptationSet mimeType="video/mp4" contentType="video" subsegmentAlignment="true" par="16:9">
   <SegmentTemplate duration="120" timescale="30" media="$RepresentationID$/$RepresentationID$_$Number$.m4v" startNumber="1" initialization="$RepresentationID$/$RepresentationID$_0.m4v"/>
   <Representation id="bbb_30fps_1024x576_2500k" codecs="avc1.64001f" bandwidth="3134488" width="1024" height="576" frameRate="30" sar="1:1"/>
   <Representation id="bbb_30fps_1920x1080_8000k" codecs="avc1.640028" bandwidth="9914554" width="1920" height="1080" frameRate="30" sar="1:1"/>
  </AdaptationSet>
  <AdaptationSet mimeType="audio/mp4" contentType="audio" subsegmentAlignment="true">
   <Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>
   <SegmentTemplate duration="192512" timescale="48000" media="$RepresentationID$/$RepresentationID$_$Number$.m4a" startNumber="1" initialization="$RepresentationID$/$RepresentationID$_0.m4a"/>
   <Representation id="bbb_a64k" codecs="mp4a.40.5" bandwidth="67071" audioSamplingRate="48000">
    <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
   </Representation>
  </AdaptationSet>
 </Period>
</MPD>`;

/** DASH-IF on-demand test case: one file per representation, byte ranges for the initialisation and the index, absolute `BaseURL`. */
export const ON_DEMAND_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${NAMESPACE} type="static" mediaPresentationDuration="PT654S">
  <BaseURL>http://dash.edgesuite.net/dash264/TestCases/1a/netflix/</BaseURL>
  <Period>
    <!-- English Audio -->
    <AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.5" lang="en" subsegmentAlignment="true">
      <Representation id="1" bandwidth="72000">
        <BaseURL>ElephantsDream_AAC48K_064.mp4.dash</BaseURL>
        <SegmentBase indexRange="871-11131">
          <Initialization range="0-870"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
    <!-- Video -->
    <AdaptationSet mimeType="video/mp4" codecs="avc1.42401E" subsegmentAlignment="true" contentType='video' maxWidth="480" maxHeight="360">
      <Representation id="5" bandwidth="750000" width="480" height="360" frameRate="24" sar="1:1">
        <BaseURL>ElephantsDream_H264BPL30_0500.264.dash</BaseURL>
        <SegmentBase indexRange="985-11245">
          <Initialization range="0-984"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

/** A timeline: three 6 s segments (one entry repeated twice) and a 2 s one; frame rate as a fraction. */
export const TIMELINE_MANIFEST = `<MPD type="static" mediaPresentationDuration="PT20S" ${NAMESPACE}>
 <Period>
  <AdaptationSet mimeType="video/mp4" codecs="avc1.4d401f">
   <SegmentTemplate timescale="1000" initialization="init-$RepresentationID$.mp4" media="seg-$RepresentationID$-$Time$.m4s">
    <SegmentTimeline><S t="0" d="6000" r="2"/><S d="2000"/></SegmentTimeline>
   </SegmentTemplate>
   <Representation id="v1" bandwidth="1000000" width="1280" height="720" frameRate="30000/1001"/>
  </AdaptationSet>
 </Period>
</MPD>`;

/** Builds a one-set manifest with the given segment template inside a video adaptation set. */
export function templateManifest(template: string, mpdAttributes = 'mediaPresentationDuration="PT25S"'): string {
  return `<MPD type="static" ${mpdAttributes} ${NAMESPACE}>
 <Period>
  <AdaptationSet mimeType="video/mp4">
   ${template}
   <Representation id="r1" bandwidth="500000" width="640" height="360"/>
  </AdaptationSet>
 </Period>
</MPD>`;
}

/** An audio representation listed with `SegmentList`. */
export const LIST_MANIFEST = `<MPD type="static" mediaPresentationDuration="PT8S" ${NAMESPACE}>
 <Period>
  <AdaptationSet contentType="audio" lang="de">
   <Representation id="a" bandwidth="64000" mimeType="audio/mp4" codecs="mp4a.40.2">
    <SegmentList duration="4" timescale="1">
     <Initialization sourceURL="init.mp4" range="0-99"/>
     <SegmentURL media="s1.m4s"/>
     <SegmentURL media="s2.m4s" mediaRange="100-199"/>
    </SegmentList>
   </Representation>
  </AdaptationSet>
 </Period>
</MPD>`;

/** A representation that is just a file at its `BaseURL`. */
export const PLAIN_FILE_MANIFEST = `<MPD type="static" ${NAMESPACE}>
 <Period>
  <AdaptationSet mimeType="video/mp4">
   <Representation id="1" bandwidth="800000" width="640" height="360"><BaseURL>movie.mp4</BaseURL></Representation>
  </AdaptationSet>
 </Period>
</MPD>`;

/** A manifest whose video adaptation set carries the given content protection elements. */
export function protectedManifest(protection: string): string {
  return `<MPD type="static" mediaPresentationDuration="PT10S" ${NAMESPACE}>
 <Period>
  <AdaptationSet mimeType="video/mp4">
   ${protection}
   <SegmentTemplate duration="2" media="s$Number$.m4s" initialization="init.mp4"/>
   <Representation id="v" bandwidth="1000000" width="640" height="360"/>
  </AdaptationSet>
 </Period>
</MPD>`;
}
