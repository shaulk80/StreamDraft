import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';

// Serves the pages in tests/pages on 127.0.0.1, so the content script (which
// matches web pages, not file:// ones) runs on them. Used by the smoke test, and
// by hand: `pnpm run testpage`. The /media files are filler bytes with the right
// content type and range support; they are for detection and download tests, not playback.

const PAGES: Readonly<Record<string, string>> = {
  '/': 'video.html',
  '/detect.html': 'detect.html',
};

interface MediaFile {
  contentType: string;
  sizeBytes: number;
}

const KILOBYTE = 1024;

const MEDIA: Readonly<Record<string, MediaFile>> = {
  '/media/direct.mp4': { contentType: 'video/mp4', sizeBytes: 300 * KILOBYTE },
  '/media/clip.webm': { contentType: 'video/webm', sizeBytes: 250 * KILOBYTE },
  '/media/song.mp3': { contentType: 'audio/mpeg', sizeBytes: 200 * KILOBYTE },
  '/media/late.mp4': { contentType: 'video/mp4', sizeBytes: 220 * KILOBYTE },
  '/media/hidden-stream': { contentType: 'video/mp4', sizeBytes: 400 * KILOBYTE },
  '/media/tiny.mp4': { contentType: 'video/mp4', sizeBytes: 2 * KILOBYTE },
};

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

export interface TestPageServer {
  url: string;
  close(): Promise<void>;
}

function sendPage(response: ServerResponse, fileName: string): void {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(readFileSync(path.join(import.meta.dirname, fileName)));
}

/** Resolves a Range header to the first and last byte to send, or undefined when it cannot be satisfied. */
function parseRange(header: string, sizeBytes: number): { start: number; end: number } | undefined {
  const match = RANGE_PATTERN.exec(header);
  if (!match) {
    return undefined;
  }

  const [, first = '', last = ''] = match;
  if (first === '' && last === '') {
    return undefined;
  }
  // "-500" is the last 500 bytes.
  const start = first === '' ? Math.max(0, sizeBytes - Number(last)) : Number(first);
  const end = first === '' || last === '' ? sizeBytes - 1 : Math.min(Number(last), sizeBytes - 1);
  return start <= end && start < sizeBytes ? { start, end } : undefined;
}

function sendMedia(request: IncomingMessage, response: ServerResponse, file: MediaFile): void {
  response.setHeader('Content-Type', file.contentType);
  response.setHeader('Accept-Ranges', 'bytes');

  const rangeHeader = request.headers.range;
  if (rangeHeader === undefined) {
    response.setHeader('Content-Length', file.sizeBytes);
    response.end(Buffer.alloc(file.sizeBytes));
    return;
  }

  const range = parseRange(rangeHeader, file.sizeBytes);
  if (!range) {
    response.statusCode = 416;
    response.setHeader('Content-Range', `bytes */${file.sizeBytes}`);
    response.end();
    return;
  }

  response.statusCode = 206;
  response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.sizeBytes}`);
  response.setHeader('Content-Length', range.end - range.start + 1);
  response.end(Buffer.alloc(range.end - range.start + 1));
}

function handle(request: IncomingMessage, response: ServerResponse): void {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

  const page = PAGES[pathname];
  if (page !== undefined) {
    sendPage(response, page);
    return;
  }

  const media = MEDIA[pathname];
  if (media !== undefined) {
    sendMedia(request, response, media);
    return;
  }

  response.statusCode = 404;
  response.end('Not found');
}

/** Starts the server on `port` (0 picks a free one). */
export function startTestPageServer(port: number): Promise<TestPageServer> {
  const server: Server = createServer(handle);

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${actualPort}/`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

if (import.meta.main) {
  const started = await startTestPageServer(8123);
  console.log(`Test pages: ${started.url} (overlay) and ${started.url}detect.html (detection)  (Ctrl+C to stop)`);
}
