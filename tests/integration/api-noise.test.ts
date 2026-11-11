import { fileURLToPath } from "node:url";
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scanner } from '../../src/scanner.js';
import { resolveConfig } from '../../src/config.js';
import { startStaticServer, type StaticServer } from '../../src/dev-server.js';

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'api-noise');

let server: StaticServer;

beforeAll(async () => {
  server = await startStaticServer(FIXTURE_DIR);
});

afterAll(async () => {
  await server.close();
});

describe('API business statuses are not resource faults (v0.7.0 accuracy fix)', () => {
  it(
    'does not report a handled first-party fetch 404, while still reporting a broken image',
    async () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-api-'));
      const { config } = resolveConfig({
        entry: server.url,
        maxPages: 2,
        runTimeoutMs: 120_000,
        verification: { attempts: 2 }
      });
      const { result } = await new Scanner(config, out).run();

      // The genuinely broken image is still detected through the same channel.
      const brokenImg = result.findings.find(
        (f) => f.type === 'resource-load-failure' && f.evidence.resourceUrl?.includes('/img/missing.png')
      );
      expect(brokenImg, 'broken <img> must still be reported').toBeTruthy();

      // The handled fetch 404 is an application-level business status, not a
      // page fault: REST lookups legitimately 404 and pages handle it.
      const apiNoise = result.findings.filter(
        (f) => f.type === 'resource-load-failure' && (f.evidence.resourceUrl || '').includes('/api/')
      );
      expect(apiNoise, 'handled fetch 404 must not be reported as a resource failure').toHaveLength(0);
    },
    120_000
  );

  it(
    'does not report a client-initiated fetch abort (stale-request cancel), but keeps real network failures',
    async () => {
      // Custom server (not the static fixture): needs a slow endpoint so the
      // page's AbortController reliably cancels the request mid-flight, and a
      // socket-killing endpoint to prove real network failures stay reported.
      const http = await import('node:http');
      const srv = http.createServer((req, res) => {
        if ((req.url || '').startsWith('/api/slow')) {
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"status":"slow-ok"}');
          }, 1500);
          return;
        }
        if ((req.url || '').startsWith('/api/kill-socket')) {
          // Destroy the connection without a response: a real network failure
          // (net::ERR_EMPTY_RESPONSE on the client) that must stay reported.
          req.socket.destroy();
          return;
        }
        if ((req.url || '').startsWith('/refused')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(
            `<!doctype html><html><body><p id="r">pending</p><script>
              fetch('/api/kill-socket').then(r => r.json()).catch(e => {
                document.getElementById('r').textContent = 'network failed as designed';
              });
            </script></body></html>`
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><html><body><p id="out">pending</p><a href="/refused">next</a><script>
            const c = new AbortController();
            fetch('/api/slow', { signal: c.signal })
              .then(r => r.json())
              .then(() => { document.getElementById('out').textContent = 'unexpected'; })
              .catch(e => { document.getElementById('out').textContent = 'aborted by design'; });
            setTimeout(() => c.abort(), 120);
          </script></body></html>`
        );
      });
      await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const address = srv.address();
      const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;

      try {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-abort-'));
        const { config } = resolveConfig({
          entry: baseUrl,
          maxPages: 4,
          runTimeoutMs: 120_000,
          verification: { attempts: 2 }
        });
        const { result } = await new Scanner(config, out).run();

        // Client-cancelled fetches are application behaviour, not page faults.
        const abortNoise = result.findings.filter(
          (f) => f.type === 'resource-load-failure' && (f.evidence.failureText || '').includes('ABORT')
        );
        expect(abortNoise, 'client-initiated fetch abort must not be reported as a fault').toHaveLength(0);

        // A real network-level failure on a fetch (server destroyed the socket)
        // must STILL be reported — the filter only hides intentional cancels.
        const realFailure = result.findings.find(
          (f) => f.type === 'resource-load-failure' && (f.evidence.resourceUrl || '').includes('/api/kill-socket')
        );
        expect(realFailure, 'real network failure on fetch must stay reported').toBeTruthy();
        expect(realFailure!.evidence.failureText).not.toContain('ABORT');
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
      }
    },
    120_000
  );
});
