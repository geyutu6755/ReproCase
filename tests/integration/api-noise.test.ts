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
});
