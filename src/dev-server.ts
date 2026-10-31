import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm'
};

export interface StaticServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface StaticServerOptions {
  /**
   * Serve index.html for extension-less unknown paths (SPA hosting mode).
   * Default off: unknown paths return real 404s so broken-link and
   * page-load-failure detection works.
   */
  spaFallback?: boolean;
}

/**
 * Minimal static file server used by `reprocase demo` and the test suite.
 * Intentionally returns proper 404s (no SPA fallback) so broken links and
 * missing resources are detectable.
 */
export async function startStaticServer(
  rootDir: string,
  opts: StaticServerOptions = {}
): Promise<StaticServer> {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.normalize(path.join(root, urlPath));
      if (!filePath.startsWith(root)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
      }
      let stat = fs.statSync(filePath, { throwIfNoEntry: false });
      if (stat?.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        stat = fs.statSync(filePath, { throwIfNoEntry: false });
      }
      if (!stat) {
        const extless = !path.extname(urlPath);
        if (opts.spaFallback && extless) {
          const index = path.join(root, 'index.html');
          const indexStat = fs.statSync(index, { throwIfNoEntry: false });
          if (indexStat) {
            res.writeHead(200, {
              'Content-Type': MIME['.html'],
              'Content-Length': indexStat.size,
              'Cache-Control': 'no-store'
            });
            fs.createReadStream(index).pipe(res);
            return;
          }
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + urlPath);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 Internal Server Error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
