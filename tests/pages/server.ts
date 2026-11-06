import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

// Serves tests/pages/video.html on 127.0.0.1, so the content script (which
// matches web pages, not file:// ones) runs on it. Used by the smoke test, and
// by hand: `pnpm run testpage`.

const PAGE = path.join(import.meta.dirname, 'video.html');

export interface TestPageServer {
  url: string;
  close(): Promise<void>;
}

/** Starts the server on `port` (0 picks a free one). */
export function startTestPageServer(port: number): Promise<TestPageServer> {
  const server: Server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(readFileSync(PAGE));
  });

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
  console.log(`Test page: ${started.url}  (Ctrl+C to stop)`);
}
