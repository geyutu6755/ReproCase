import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scanner } from '../../src/scanner.js';
import { resolveConfig } from '../../src/config.js';
import { startStaticServer, type StaticServer } from '../../src/dev-server.js';
import { PROJECT_ROOT } from '../helpers/demo-server.js';

/**
 * v0.3.0 observation-window regressions: the adaptive window must catch
 * faults fired past the old fixed 600 ms settle, honour the configured
 * window (a short window honestly misses late faults), and flag pages whose
 * async activity never settles (long polling) instead of waiting forever.
 */

let lateServer: StaticServer;
let pollServer: StaticServer;

beforeAll(async () => {
  lateServer = await startStaticServer(path.join(PROJECT_ROOT, 'audit', 'apps', 'late-fault'));
  pollServer = await startStaticServer(path.join(PROJECT_ROOT, 'audit', 'apps', 'long-poll'));
});

afterAll(async () => {
  await lateServer.close();
  await pollServer.close();
});

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-obs-'));
}

describe('adaptive async-observation window', () => {
  it(
    'default window catches a fault 1000 ms after load (missed by the fixed 600 ms settle)',
    async () => {
      const out = tmpOut();
      const { config } = resolveConfig({
        entry: lateServer.url,
        maxPages: 2,
        runTimeoutMs: 120_000,
        verification: { attempts: 1 }
      });
      const { result } = await new Scanner(config, out).run();
      const boom = result.findings.find((f) => f.title.includes('LateFault'));
      expect(boom, 'LateFault must be detected with the default window').toBeDefined();
      expect(boom!.status).toBe('verified');
      expect(result.pages[0].observationTimedOut).toBeFalsy(); // page went quiet
      expect(result.stats.observationTimeouts).toBe(0);
      // Bounded: a single-page scan must stay well inside its budget.
      expect(result.stats.durationMs).toBeLessThan(60_000);
    },
    180_000
  );

  it(
    'a short window does not keep the page alive for faults beyond its budget (budget is real)',
    async () => {
      // The sample throws at 1000 ms; here the app variant throws at 2500 ms.
      // With window 400 / maxWait 400 the page closes long before 2500 ms, so
      // the fault is honestly missed — proving the budget actually bounds the
      // scan instead of being decorative.
      const dir = path.join(PROJECT_ROOT, 'audit', 'apps', 'late-fault');
      const tmpSite = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-late-'));
      fs.copyFileSync(path.join(dir, 'index.html'), path.join(tmpSite, 'index.html'));
      let html = fs.readFileSync(path.join(tmpSite, 'index.html'), 'utf8');
      html = html.replace(', 1000);', ', 8000);');
      fs.writeFileSync(path.join(tmpSite, 'index.html'), html, 'utf8');

      const { startStaticServer: start } = await import('../../src/dev-server.js');
      const shortServer = await start(tmpSite);
      try {
        const out = tmpOut();
        const { config } = resolveConfig({
          entry: shortServer.url,
          maxPages: 2,
          runTimeoutMs: 120_000,
          verification: { attempts: 1 },
          detection: { windowMs: 400, maxWaitMs: 400 }
        });
        const { result } = await new Scanner(config, out).run();
        const boom = result.findings.find((f) => f.title.includes('LateFault'));
        expect(boom, 'fault at 8000 ms must be missed with a 400 ms budget (documented trade-off)').toBeUndefined();
      } finally {
        await shortServer.close();
        fs.rmSync(tmpSite, { recursive: true, force: true });
      }
    },
    180_000
  );

  it(
    'long-polling page: bounded wait, fault detected, page flagged as not fully observed',
    async () => {
      const out = tmpOut();
      const { config } = resolveConfig({
        entry: pollServer.url,
        maxPages: 2,
        runTimeoutMs: 120_000,
        verification: { attempts: 1 },
        detection: { windowMs: 1200, maxWaitMs: 2500 }
      });
      const { result } = await new Scanner(config, out).run();
      const boom = result.findings.find((f) => f.title.includes('PollBoom'));
      expect(boom, 'deferred fault inside the window must be detected').toBeDefined();
      expect(boom!.status).toBe('verified');
      expect(result.pages[0].observationTimedOut, 'long-poll page never goes quiet').toBe(true);
      expect(result.stats.observationTimeouts).toBe(1);
      // Budget held: scan stayed far below the run timeout even though the
      // page keeps polling forever.
      expect(result.stats.durationMs).toBeLessThan(60_000);
    },
    180_000
  );
});
