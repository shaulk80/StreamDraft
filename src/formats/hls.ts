import { fail, type Result } from '../core/result.ts';
import { parseMasterPlaylist } from './hls-master.ts';
import { MediaPlaylistParser } from './hls-media.ts';
import { parseTag, playlistLines } from './hls-lines.ts';
import type { HlsPlaylist } from './hls-types.ts';

const PLAYLIST_HEADER = '#EXTM3U';
const MASTER_MARKER = '#EXT-X-STREAM-INF';

/**
 * Parses an HLS playlist of either kind. `playlistUrl` is the address the text
 * was fetched from (after redirects): relative addresses in the text are
 * resolved against it. SAMPLE-AES and DRM key formats come back as a playlist
 * with `protectedReason` and no segments; broken or unsupported input comes
 * back as an error with a message for the popup.
 */
export function parseHlsPlaylist(text: string, playlistUrl: string): Result<HlsPlaylist> {
  if (!URL.canParse(playlistUrl)) {
    return fail(`Not a valid address: ${playlistUrl}`);
  }

  const lines = playlistLines(text);
  if (lines[0] !== PLAYLIST_HEADER) {
    return fail('Not an HLS playlist.');
  }

  const isMaster = lines.some((line) => parseTag(line)?.name === MASTER_MARKER);
  if (isMaster) {
    return parseMasterPlaylist(lines, playlistUrl);
  }
  return new MediaPlaylistParser(playlistUrl).parse(lines);
}
