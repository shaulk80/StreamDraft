export type TrackKind = 'video' | 'audio';

/** What a fragment's `trun` leaves out, from the init segment's `trex`. */
export interface SampleDefaults {
  duration: number;
  size: number;
  flags: number;
}

/** A track of a source, as its init segment describes it. */
export interface TrackInfo {
  /** The track's id in the source. */
  sourceId: number;
  kind: TrackKind;
  timescale: number;
  /** The `stsd` box, whole: it holds the codec configuration. */
  sampleDescription: Uint8Array;
  /** Type of the first sample entry (`avc1`, `mp4a`, ...). */
  codec: string;
  /** The track header's width and height, as 16.16 fixed point numbers. */
  width: number;
  height: number;
  /** The track header's 36-byte transformation matrix (rotation); identity when absent. */
  matrix?: Uint8Array;
  defaults: SampleDefaults;
}

export interface Sample {
  duration: number;
  size: number;
  /** Composition time offset: presentation time minus decoding time. */
  cto: number;
  /** A sample a decoder can start from. */
  sync: boolean;
}

/** One run of consecutive samples of a track and their bytes. */
export interface TrackFragment {
  sourceTrackId: number;
  samples: Sample[];
  /** The samples' bytes, back to back. */
  payload: Uint8Array;
  /** Decoding time of the first sample (`tfdt`), when the fragment states one. */
  startTime?: number;
}
