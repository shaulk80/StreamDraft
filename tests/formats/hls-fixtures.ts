/** Playlists for the HLS parser tests. The first group is cut down from public test streams (see docs/spikes/samples). */

export const MASTER_URL = 'https://cdn.example.com/video/master.m3u8';
export const MEDIA_URL = 'https://cdn.example.com/video/gear3/prog_index.m3u8';

/** Apple bipbop master: TS renditions with muxed audio, plus one audio-only rendition. */
export const BIPBOP_MASTER = `#EXTM3U


#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=232370,CODECS="mp4a.40.2, avc1.4d4015"
gear1/prog_index.m3u8

#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=991714,CODECS="mp4a.40.2, avc1.4d401e"
gear3/prog_index.m3u8

#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=41457,CODECS="mp4a.40.2"
gear0/prog_index.m3u8
`;

/** Apple advanced fMP4 master: resolutions, frame rates, audio groups, a repeated video playlist, key-frame and subtitle entries. */
export const FMP4_MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2168183,BANDWIDTH=2177116,CODECS="avc1.640020,mp4a.40.2",RESOLUTION=960x540,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v5/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=7968416,BANDWIDTH=8001098,CODECS="avc1.64002a,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v9/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2390686,BANDWIDTH=2399619,CODECS="avc1.640020,ac-3",RESOLUTION=960x540,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud2",SUBTITLES="sub1"
v5/prog_index.m3u8
#EXT-X-I-FRAME-STREAM-INF:AVERAGE-BANDWIDTH=97767,BANDWIDTH=101378,CODECS="avc1.640020",RESOLUTION=960x540,URI="v5/iframe_index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="en",NAME="English",AUTOSELECT=YES,DEFAULT=YES,CHANNELS="2",URI="a1/prog_index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud2",LANGUAGE="en",NAME="English",AUTOSELECT=YES,DEFAULT=YES,CHANNELS="6",URI="a2/prog_index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub1",NAME="English",DEFAULT=YES,URI="s1/en/prog_index.m3u8"
`;

/** Apple bipbop media playlist, first segments. */
export const BIPBOP_MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:9.97667,	
fileSequence0.ts
#EXTINF:9.97667,	
fileSequence1.ts
#EXTINF:9.97667,	
fileSequence2.ts
#EXT-X-ENDLIST
`;

/** A rolling live playlist: no end marker, the first segment is number 2680. */
export const LIVE_MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:2680
#EXTINF:6.0,
seg2680.ts
#EXTINF:6.0,
seg2681.ts
`;

/** fMP4 playlist: init section, byte ranges of one file (the second without an offset), a discontinuity. */
export const BYTE_RANGE_MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="main.mp4",BYTERANGE="720@0"
#EXTINF:6.0,
#EXT-X-BYTERANGE:50000@720
main.mp4
#EXTINF:6.0,
#EXT-X-BYTERANGE:48000
main.mp4
#EXT-X-DISCONTINUITY
#EXT-X-MAP:URI="init2.mp4"
#EXTINF:4.5,
other.m4s
#EXT-X-ENDLIST
`;

/** AES-128: a key with an explicit IV, a rotation to a second key without one, then clear segments. */
export const AES_MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:7
#EXT-X-KEY:METHOD=AES-128,URI="keys/one.key",IV=0x000102030405060708090A0B0C0D0E0F
#EXTINF:10.0,
a.ts
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.net/two.key"
#EXTINF:10.0,
b.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:10.0,
c.ts
#EXT-X-ENDLIST
`;

export function protectedMedia(keyTag: string): string {
  return `#EXTM3U
#EXT-X-TARGETDURATION:10
${keyTag}
#EXTINF:10.0,
a.ts
#EXT-X-ENDLIST
`;
}
