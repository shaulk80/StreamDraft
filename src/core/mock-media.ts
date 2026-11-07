import type { MediaItem } from './media.ts';

const MEGABYTE = 1024 * 1024;

/**
 * Fake videos for the M1 screens. Real detection replaces this in M2; nothing
 * here touches the network.
 */
const DIRECT_ITEM: MediaItem = {
  id: 'mock-direct',
  url: 'https://example.com/media/product-demo.mp4',
  title: 'Product demo',
  site: 'example.com',
  kind: 'direct',
  container: 'mp4',
  qualities: [{ quality: '720p', label: '720p MP4', sizeBytes: 48 * MEGABYTE }],
  protected: false,
};

const HLS_ITEM: MediaItem = {
  id: 'mock-hls',
  url: 'https://example.com/media/keynote/master.m3u8',
  title: 'Conference talk: opening keynote',
  site: 'example.com',
  kind: 'hls',
  container: 'mp4',
  qualities: [
    { quality: '1080p', label: '1080p', sizeBytes: 820 * MEGABYTE },
    { quality: '720p', label: '720p', sizeBytes: 410 * MEGABYTE },
    { quality: '480p', label: '480p', sizeBytes: 190 * MEGABYTE },
    { quality: 'audio', label: 'Audio only', sizeBytes: 38 * MEGABYTE },
  ],
  protected: false,
};

const DASH_ITEM: MediaItem = {
  id: 'mock-dash',
  url: 'https://example.org/media/episode-3/manifest.mpd',
  title: 'Nature documentary, episode 3',
  site: 'example.org',
  kind: 'dash',
  container: 'mp4',
  qualities: [
    { quality: '1080p', label: '1080p', sizeBytes: 1400 * MEGABYTE },
    { quality: '360p', label: '360p', sizeBytes: 160 * MEGABYTE },
  ],
  protected: false,
};

const PROTECTED_ITEM: MediaItem = {
  id: 'mock-protected',
  url: 'https://example.net/media/premium/manifest.mpd',
  title: 'Premium movie (DRM)',
  site: 'example.net',
  kind: 'dash',
  container: 'mp4',
  qualities: [],
  protected: true,
};

export const MOCK_MEDIA: readonly MediaItem[] = [DIRECT_ITEM, HLS_ITEM, DASH_ITEM, PROTECTED_ITEM];

/** The item the overlay and the context menu show in M1: every video is this one. */
export const DEMO_ITEM: MediaItem = HLS_ITEM;
