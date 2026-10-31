import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scanner } from '../../src/scanner.js';
import { resolveConfig } from '../../src/config.js';
import { startDemoServer } from '../helpers/demo-server.js';
import type { StaticServer } from '../../src/dev-server.js';

let server: StaticServer;

beforeAll(async () => {
  server = await startDemoServer();
});

afterAll(async () => {
  await server.close();
});

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-it-'));
}

describe('Scanner against the demo site (real browser)', () => {
  it(
    'detects all four planted faults from the index page and verifies each independently',
    async () => {
      const out = tmpOut();
      const { config } = resolveConfig({
        entry: server.url,
        maxPages: 12,
        runTimeoutMs: 180_000,
        verification: { attempts: 2 }
      });
      const { result } = await new Scanner(config, out).run();

      const types = new Set(result.findings.map((f) => f.type));
      // The four planted demo faults:
      expect(types.has('js-exception'), 'fault 1: js exception').toBe(true);
      expect(types.has('page-load-failure'), 'fault 2: 404 page').toBe(true);
      expect(types.has('horizontal-overflow'), 'fault 3: mobile overflow').toBe(true);
      expect(types.has('resource-load-failure'), 'fault 4: broken image').toBe(true);
      expect(types.has('broken-internal-link'), 'broken link corollary').toBe(true);

      // Verification discipline: every non-informational finding reproduced in
      // every independent attempt; console errors stay suspected.
      for (const f of result.findings) {
        if (f.type === 'console-error') {
          expect(f.status).toBe('suspected');
          continue;
        }
        expect(f.status, `${f.type} should be verified`).toBe('verified');
        expect(f.repro.successes).toBe(f.repro.attempts);
        expect(f.repro.attempts).toBeGreaterThanOrEqual(2);
      }

      // The overflow is mobile-specific on this site.
      const overflow = result.findings.find((f) => f.type === 'horizontal-overflow')!;
      expect(overflow.evidence.viewport).toBe('mobile');
      expect(overflow.evidence.offenders?.length).toBeGreaterThan(0);

      // The explorer really interacted with the site.
      expect(result.stats.actionsPerformed).toBeGreaterThan(0);
      expect(result.stats.pagesVisited).toBeGreaterThanOrEqual(6);

      // Evidence artifacts exist on disk.
      expect(fs.existsSync(path.join(out, 'artifacts', 'screenshots'))).toBe(true);
      const screenshots = fs.readdirSync(path.join(out, 'artifacts', 'screenshots'));
      expect(screenshots.length).toBeGreaterThan(0);
      const traces = fs.readdirSync(path.join(out, 'artifacts', 'traces'));
      expect(traces.some((t) => t.endsWith('.zip'))).toBe(true);

      // Honesty markers: not-checked list and no entry failure.
      expect(result.notChecked.length).toBeGreaterThan(0);
      expect(result.entryUnreachable).toBeFalsy();
    },
    240_000
  );

  it(
    'reports zero findings on the clean control pages (no false positives)',
    async () => {
      const out = tmpOut();
      const { config } = resolveConfig({
        entry: new URL('clean.html', server.url).href,
        maxPages: 4,
        runTimeoutMs: 120_000,
        verification: { attempts: 2 }
      });
      const { result } = await new Scanner(config, out).run();

      expect(result.pages.map((p) => p.url)).toEqual(
        expect.arrayContaining([expect.stringContaining('clean.html'), expect.stringContaining('clean-2.html')])
      );
      expect(result.findings).toEqual([]);
      expect(result.summary.verified).toBe(0);
      expect(result.summary.suspected).toBe(0);
    },
    240_000
  );
});
