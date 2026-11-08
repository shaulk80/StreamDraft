/** The part of mux.js 6.3 that the engine uses (the package ships no types). */
declare module 'mux.js' {
  interface TimingInfo {
    /** Length of the previous GOP that was put in front of this segment's video, in 90 kHz ticks. */
    prependedContentDuration: number;
  }

  interface TransmuxedSegment {
    /** `ftyp` and `moov` for the tracks of this segment. */
    initSegment: Uint8Array;
    /** `moof` and `mdat` pairs, one per track. */
    data: Uint8Array;
  }

  interface Transmuxer {
    on(event: 'data', listener: (segment: TransmuxedSegment) => void): void;
    on(event: 'videoSegmentTimingInfo', listener: (info: TimingInfo) => void): void;
    push(bytes: Uint8Array): void;
    flush(): void;
    dispose(): void;
  }

  const muxjs: { mp4: { Transmuxer: new (options?: { keepOriginalTimestamps?: boolean }) => Transmuxer } };
  export default muxjs;
}
