// Audit HTTP server for the TaskFlow audit site (independent of src/dev-server.ts).
// Behaviours under test:
//   - GET /redirect.html  -> 301 to /final.html   (redirect handling)
//   - GET /app/*          -> serves spa.html      (SPA hosting fallback; deep links must 200)
//   - everything else     -> plain static files with REAL 404s (no SPA fallback)
// Usage: node audit/audit-server.mjs <port> <rootDir>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || 4640);
const root = path.resolve(process.argv[3] || 'audit/audit-site');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (urlPath === '/redirect.html') {
    res.writeHead(301, { Location: '/final.html' });
    res.end('Moved permanently');
    return;
  }

  let filePath;
  if (urlPath === '/app' || urlPath.startsWith('/app/')) {
    filePath = path.join(root, 'spa.html');
  } else {
    filePath = path.normalize(path.join(root, urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('403');
      return;
    }
    let stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = fs.statSync(filePath, { throwIfNoEntry: false });
    }
    if (!stat) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => console.log(`AUDIT_SERVER_READY http://127.0.0.1:${port}/ root=${root}`));
