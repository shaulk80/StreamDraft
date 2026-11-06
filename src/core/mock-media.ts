import type { MediaItem } from './media.ts';

const MEGABYTE = 1024 * 1024;

/**
 * Fake videos for the M1 screens. Real detection replaces this in M2; nothing
 * here touches the network.
 */
export const MOCK_MEDIA: readonly MediaItem[] = [
  {
    id: 'mock-direct',
    title: 'Product demo',
    site: 'example.com',
    kind: 'direct',
    container: 'mp4',
    qualities: [{ quality: '720p', label: '720p MP4', sizeBytes: 48 * MEGABYTE }],
    protected: false,
  },
  {
    id: 'mock-hls',
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
  },
  {
    id: 'mock-dash',
    title: 'Nature documentary, episode 3',
    site: 'example.org',
    kind: 'dash',
    container: 'mp4',
    qualities: [
      { quality: '1080p', label: '1080p', sizeBytes: 1400 * MEGABYTE },
      { quality: '360p', label: '360p', sizeBytes: 160 * MEGABYTE },
    ],
    protected: false,
  },
  {
    id: 'mock-protected',
    title: 'Premium movie (DRM)',
    site: 'example.net',
    kind: 'dash',
    container: 'mp4',
    qualities: [],
    protected: true,
  },
];
