import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get } from 'node:http';
import { startDemoServer } from '../helpers/demo-server.js';
import type { StaticServer } from '../../src/dev-server.js';

let server: StaticServer;

beforeAll(async () => {
  server = await startDemoServer();
});

afterAll(async () => {
  await server.close();
});

function getAsync(path: string): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    get(server.url.replace(/\/$/, '') + path, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, contentType: String(res.headers['content-type'] ?? ''), body })
      );
    }).on('error', reject);
  });
}

describe('static demo server', () => {
  it('serves index.html for the directory root', async () => {
    const r = await getAsync('/');
    expect(r.status).toBe(200);
    expect(r.contentType).toContain('text/html');
    expect(r.body).toContain('ReproCase demo site');
  });

  it('serves css with the right content type', async () => {
    const r = await getAsync('/site.css');
    expect(r.status).toBe(200);
    expect(r.contentType).toContain('text/css');
  });

  it('returns a real 404 for missing files (needed for fault detection)', async () => {
    const r = await getAsync('/missing-page.html');
    expect(r.status).toBe(404);
  });

  it('rejects path traversal', async () => {
    const r = await getAsync('/../../package.json');
    expect([403, 404]).toContain(r.status);
    expect(r.body).not.toContain('"name"');
  });
});
